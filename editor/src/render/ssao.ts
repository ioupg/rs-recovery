/* Screen-space AO, integrated into the PBR lighting rather than composited
   over it (notes/09-render-path.md — replaces the per-vertex occupancy bake,
   which could only darken diffuse albedo and so vanished on the metal-heavy
   library). Three passes before the main render:

     1. depth prepass — the ship solid only (AO_LAYER), override material
     2. AO estimate — view-space hemisphere obscurance from depth alone
        (normals reconstructed from depth derivatives; every surface here is
        flat-faceted, so derivative normals are exact away from edges)
     3. separable depth-aware blur to kill the rotation noise

   The result feeds the ship materials through patchScreenAO(): a shader hook
   right after three's own aomap_fragment that multiplies indirect diffuse and
   runs indirect specular through the same roughness/angle-aware occlusion
   curve a real aoMap would use. Direct light and emissive are untouched —
   the shadow map owns direct occlusion.

   Module-level shared uniforms tie the two halves together: materials compile
   against them once, the single ScreenAO instance (the main viewport — the
   preview contexts never patch) writes into them every frame. When disabled
   the uniform holds a 1x1 white texture and the passes are skipped. */

import * as THREE from 'three';

/** ship solid meshes enable this layer; the depth prepass renders only it,
    so overlays/grid/ghosts neither occlude nor receive */
export const AO_LAYER = 1;

/* world-space knobs, in cell units (cell = 1). RADIUS is how far a surface
   looks for occluders — 0.7 spans a plate relief and reaches the neighbouring
   cell wall without greying whole hull bays. */
const AO_RADIUS = 0.7;
const AO_INTENSITY = 1.0;
/** cos-threshold against self-occlusion on flat facets */
const AO_BIAS = 0.08;
const AO_SAMPLES = 16;

const whiteTexture = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** shared between the ScreenAO instance and every patched material */
const uAO = { value: whiteTexture as THREE.Texture };
const uTexel = { value: new THREE.Vector2(1, 1) };

/** Hook a ship material into the screen AO (idempotent per material — call
    once at creation). Injected after aomap_fragment so it composes with, and
    behaves exactly like, three's own AO path. */
export function patchScreenAO(m: THREE.MeshPhysicalMaterial): void {
  m.onBeforeCompile = shader => {
    shader.uniforms.tScreenAO = uAO;
    shader.uniforms.uScreenAOTexel = uTexel;
    shader.fragmentShader =
      'uniform sampler2D tScreenAO;\nuniform vec2 uScreenAOTexel;\n' +
      shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
	{
		float ssAO = texture2D( tScreenAO, gl_FragCoord.xy * uScreenAOTexel ).r;
		reflectedLight.indirectDiffuse *= ssAO;
		#if defined( USE_CLEARCOAT )
			clearcoatSpecularIndirect *= ssAO;
		#endif
		#if defined( USE_ENVMAP ) && defined( STANDARD )
			// three's computeSpecularOcclusion, inlined (its chunk guard is aoMap-only)
			float ssDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
			reflectedLight.indirectSpecular *= saturate( pow( ssDotNV + ssAO, exp2( - 16.0 * material.roughness - 1.0 ) ) - 1.0 + ssAO );
		#endif
	}`);
  };
  m.customProgramCacheKey = () => 'screen-ao';
}

const FS_VERT = /* glsl */`
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`;

const AO_FRAG = /* glsl */`
precision highp float;
uniform highp sampler2D tDepth;
uniform mat4 uProjInv;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uIntensity;
uniform float uProjScale;   // pixels per world unit at view depth 1
in vec2 vUv;
out vec4 oColor;

vec3 viewPos( vec2 uv ) {
	float d = texture( tDepth, uv ).x;
	vec4 p = uProjInv * vec4( vec3( uv, d ) * 2.0 - 1.0, 1.0 );
	return p.xyz / p.w;
}

void main() {
	float d0 = texture( tDepth, vUv ).x;
	if ( d0 >= 1.0 ) { oColor = vec4( 1.0 ); return; }
	vec3 p = viewPos( vUv );
	vec3 n = normalize( cross( dFdx( p ), dFdy( p ) ) );
	p += n * 0.02;   // lift off the surface — derivative normals jitter at edges
	float rPx = min( uProjScale * uRadius / -p.z, 96.0 );
	// interleaved gradient noise rotates the spiral per pixel; the blur eats it
	float ign = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	float occ = 0.0;
	for ( int i = 0; i < ${AO_SAMPLES}; i ++ ) {
		float a = ( float( i ) + ign ) * 2.39996323;
		float rr = sqrt( ( float( i ) + 0.5 ) / ${AO_SAMPLES}.0 ) * rPx;
		vec3 sp = viewPos( vUv + vec2( cos( a ), sin( a ) ) * rr * uTexel );
		vec3 dv = sp - p;
		float dist = length( dv );
		float range = clamp( 1.0 - dist / uRadius, 0.0, 1.0 );
		occ += clamp( dot( n, dv ) / max( dist, 1e-4 ) - ${AO_BIAS.toFixed(3)}, 0.0, 1.0 ) * range;
	}
	// x2: a fully covered hemisphere averages cos/2 over the clamped samples
	float ao = 1.0 - uIntensity * clamp( occ * 2.0 / ${AO_SAMPLES}.0, 0.0, 1.0 );
	oColor = vec4( ao );
}`;

const BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAO;
uniform highp sampler2D tDepth;
uniform mat4 uProjInv;
uniform vec2 uDir;          // one texel step along the blur axis
uniform float uDepthSigma;  // view-space z tolerance, world units
in vec2 vUv;
out vec4 oColor;

float viewZ( vec2 uv ) {
	float d = texture( tDepth, uv ).x;
	vec4 p = uProjInv * vec4( vec3( uv, d ) * 2.0 - 1.0, 1.0 );
	return p.z / p.w;
}

void main() {
	float z0 = viewZ( vUv );
	float sum = texture( tAO, vUv ).r * 0.227;
	float wsum = 0.227;
	for ( int i = 1; i <= 3; i ++ ) {
		float g = i == 1 ? 0.194 : ( i == 2 ? 0.121 : 0.055 );
		for ( float s = -1.0; s <= 1.0; s += 2.0 ) {
			vec2 uv = vUv + uDir * float( i ) * s;
			float w = g * exp( - abs( viewZ( uv ) - z0 ) / uDepthSigma );
			sum += texture( tAO, uv ).r * w;
			wsum += w;
		}
	}
	oColor = vec4( sum / wsum );
}`;

function aoTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    format: THREE.RedFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

export class ScreenAO {
  enabled = true;

  private readonly renderer: THREE.WebGLRenderer;
  private size = new THREE.Vector2(0, 0);
  private readonly scratch = new THREE.Vector2();

  private depthRT!: THREE.WebGLRenderTarget;
  private aoRT!: THREE.WebGLRenderTarget;
  private blurRT!: THREE.WebGLRenderTarget;
  private finalRT!: THREE.WebGLRenderTarget;

  private readonly depthOverride = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private readonly aoMat: THREE.RawShaderMaterial;
  private readonly blurMat: THREE.RawShaderMaterial;
  private readonly fsScene = new THREE.Scene();
  private readonly fsMesh: THREE.Mesh;
  private readonly fsCam = new THREE.Camera();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    this.aoMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: AO_FRAG,
      uniforms: {
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: AO_RADIUS },
        uIntensity: { value: AO_INTENSITY },
        uProjScale: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        tAO: { value: null },
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uDir: { value: new THREE.Vector2() },
        uDepthSigma: { value: AO_RADIUS * 0.5 },
      },
      depthTest: false,
      depthWrite: false,
    });

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.fsMesh = new THREE.Mesh(tri, this.aoMat);
    this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);

    this.allocate(2, 2);
  }

  /** the blurred AO — bound into the shared material uniform every frame */
  private publish(tex: THREE.Texture): void {
    uAO.value = tex;
  }

  /** run the prepass chain; call once per frame before the main render */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) { this.publish(whiteTexture); return; }
    const r = this.renderer;
    r.getDrawingBufferSize(this.scratch);
    if (!this.scratch.equals(this.size)) this.allocate(this.scratch.x, this.scratch.y);

    const prevRT = r.getRenderTarget();
    const prevMask = camera.layers.mask;
    const prevOverride = scene.overrideMaterial;
    const prevShadowAuto = r.shadowMap.autoUpdate;

    /* 1 — depth of the ship solid only. Shadow-map updates deferred to the
       main render (this pass would otherwise re-render them every frame). */
    r.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.depthOverride;
    camera.layers.set(AO_LAYER);
    r.setRenderTarget(this.depthRT);
    r.render(scene, camera);
    scene.overrideMaterial = prevOverride;
    camera.layers.mask = prevMask;
    r.shadowMap.autoUpdate = prevShadowAuto;

    /* 2 — AO estimate */
    const au = this.aoMat.uniforms;
    au.tDepth.value = this.depthRT.depthTexture;
    (au.uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (au.uTexel.value as THREE.Vector2).set(1 / this.size.x, 1 / this.size.y);
    au.uProjScale.value = 0.5 * this.size.y * camera.projectionMatrix.elements[5];
    this.fsMesh.material = this.aoMat;
    r.setRenderTarget(this.aoRT);
    r.render(this.fsScene, this.fsCam);

    /* 3 — depth-aware blur, X then Y */
    const bu = this.blurMat.uniforms;
    bu.tDepth.value = this.depthRT.depthTexture;
    (bu.uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    this.fsMesh.material = this.blurMat;
    bu.tAO.value = this.aoRT.texture;
    (bu.uDir.value as THREE.Vector2).set(1 / this.size.x, 0);
    r.setRenderTarget(this.blurRT);
    r.render(this.fsScene, this.fsCam);
    bu.tAO.value = this.blurRT.texture;
    (bu.uDir.value as THREE.Vector2).set(0, 1 / this.size.y);
    r.setRenderTarget(this.finalRT);
    r.render(this.fsScene, this.fsCam);

    r.setRenderTarget(prevRT);
    this.publish(this.finalRT.texture);
  }

  private allocate(w: number, h: number): void {
    this.size.set(w, h);
    uTexel.value.set(1 / w, 1 / h);
    this.depthRT?.dispose();
    this.aoRT?.dispose();
    this.blurRT?.dispose();
    this.finalRT?.dispose();
    this.depthRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    this.aoRT = aoTarget(w, h);
    this.blurRT = aoTarget(w, h);
    this.finalRT = aoTarget(w, h);
  }

  dispose(): void {
    this.publish(whiteTexture);
    this.depthRT.dispose();
    this.aoRT.dispose();
    this.blurRT.dispose();
    this.finalRT.dispose();
    this.depthOverride.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
    this.fsMesh.geometry.dispose();
  }
}
