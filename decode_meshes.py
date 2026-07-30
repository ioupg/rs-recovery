#!/usr/bin/env python3
"""Decoder for RedStar compiled part meshes (compiled/meshes/RedStar/parts/*.compiled).

Container layout (a raw memory dump, like .rsconstruction — 0xCD debug fill and all):

    u32 submeshCount
    per submesh:
        material blob: floats + 0xCD padding, containing two length-prefixed
                       (u32 len + ascii) texture paths
        u32 vertexCount ; vertexCount * { pos[3]f, normal[3]f, uv[2]f }   (32 B)
        u32 indexCount  ; indexCount  * u32
    u32 trailer

Writes viewer/parts.js (catalogue for the viewer) and recovered/parts.json.
"""
import glob
import json
import math
import os
import struct
import sys

STRIDE = 32
PARTS_DIR = 'compiled/meshes/RedStar/parts'


def _unit(v, tol=.03):
    return abs(math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) - 1.0) < tol


def _verts_ok(d, at, count, stride=STRIDE):
    """Sample the candidate block: real vertices have unit normals and sane UVs."""
    if count <= 0 or at + count*stride > len(d):
        return False
    for i in range(0, count, max(1, count//32)):
        f = struct.unpack_from('<8f', d, at + i*stride)
        if not _unit(f[3:6]):
            return False
        if not all(abs(c) < 1e4 and c == c for c in f[0:3]):
            return False
        if not all(abs(c) < 256 and c == c for c in f[6:8]):
            return False
    return True


def _find_submesh(d, start):
    """Scan for a u32 vertex count whose vertex + index blocks both validate."""
    for p in range(start, len(d) - 8):
        c = struct.unpack_from('<I', d, p)[0]
        if not (3 <= c <= 300000) or not _verts_ok(d, p + 4, c):
            continue
        vend = p + 4 + c*STRIDE
        if vend + 4 > len(d):
            continue
        ic = struct.unpack_from('<I', d, vend)[0]
        if ic < 3 or ic % 3 or vend + 4 + ic*4 > len(d):
            continue
        idx = struct.unpack_from(f'<{ic}I', d, vend + 4)
        if max(idx) >= c:
            continue
        return p, c, vend, ic, idx
    return None


def _strings(d, a, b):
    out, i = [], a
    while i < min(b, len(d)) - 4:
        n = struct.unpack_from('<I', d, i)[0]
        if 3 <= n <= 260 and i + 4 + n <= len(d):
            s = d[i+4:i+4+n]
            if all(32 <= ch < 127 for ch in s):
                out.append(s.decode('ascii'))
                i += 4 + n
                continue
        i += 1
    return out


def decode(path):
    d = open(path, 'rb').read()
    declared = struct.unpack_from('<I', d, 0)[0]
    subs, pos, prev = [], 4, 4
    while True:
        hit = _find_submesh(d, pos)
        if not hit:
            break
        vstart, vcount, vend, icount, idx = hit
        pos_f, nrm_f, uv_f = [], [], []
        for i in range(vcount):
            f = struct.unpack_from('<8f', d, vstart + 4 + i*STRIDE)
            pos_f += [round(x, 5) for x in f[0:3]]
            nrm_f += [round(x, 4) for x in f[3:6]]
            uv_f += [round(x, 4) for x in f[6:8]]
        tex = sorted({t.rsplit('/', 1)[-1] for t in _strings(d, prev, vstart)})
        subs.append({'tex': tex, 'pos': pos_f, 'nrm': nrm_f, 'uv': uv_f,
                     'idx': list(idx)})
        pos = prev = vend + 4 + icount*4
    return {'file': os.path.basename(path), 'declared': declared,
            'size': len(d), 'consumed': pos, 'sub': subs}


def bbox(m):
    lo = [1e9]*3
    hi = [-1e9]*3
    for s in m['sub']:
        p = s['pos']
        for i in range(0, len(p), 3):
            for a in range(3):
                lo[a] = min(lo[a], p[i+a])
                hi[a] = max(hi[a], p[i+a])
    return lo, hi


CORNER = [(i & 1, (i >> 1) & 1, (i >> 2) & 1) for i in range(8)]
# corner sets straight from the exe's CarcassCube::vertexIndex table (0x1db7030)
SHAPE_CORNERS = {0: {0,1,2,3,4,5,6,7}, 1: {0,1,3,4,5,6,7}, 2: {0,1,4,5,6,7}, 3: {1,4,5,7}}
SHAPE_CODE = {0: 'k8', 1: 'k7', 2: 'k6', 3: 'k4'}


def corner_set(part, tol=.16):
    """Which unit-cell corners the mesh actually reaches."""
    got = set()
    for s in part['sub']:
        q = s['pos']
        for i in range(0, len(q), 3):
            v = (q[i], q[i+1], q[i+2])
            for ci, c in enumerate(CORNER):
                if all(abs(v[a]-c[a]) < tol for a in range(3)):
                    got.add(ci)
    return got


def face_window(part, tol=1e-3):
    """How much of a cell face the shape leaves open for its plate.

    These hull shapes are shells: each face is a thin rim around an empty window
    and the plate drops into that window. Measuring it rather than hard-coding it
    keeps the plate fitted if a different representative is ever chosen.
    """
    xs = set()
    for s in part['sub']:
        q = s['pos']
        for i in range(0, len(q), 3):
            if abs(q[i+2] - 1.0) < tol:
                xs.add(round(q[i], 3))
    inner = [v for v in sorted(xs) if 0.02 < v < 0.98]
    return round(1 - 2*min(inner), 3) if inner else 1.0


def pick_shape_meshes(parts):
    """Match each cube shape to the part whose corners reproduce its table exactly.

    Prefers a mid-detail candidate so the four shapes read as one set rather than
    mixing a 640-triangle cube with a 42-triangle tetrahedron.
    """
    out = {}
    for shape, want in SHAPE_CORNERS.items():
        cands = []
        for p in parts:
            zs = [c for s in p['sub'] for c in s['pos'][2::3]]
            if max(zs) - min(zs) < .6:        # thin => a face plate, not a solid
                continue
            if corner_set(p) == want:
                cands.append(p)
        if not cands:
            continue
        # the hull shapes are a matched set: same source, same 0.05 rim, same
        # texture. Prefer that family over an unrelated cage of similar poly count.
        best = min(cands, key=lambda p: (0 if 'craftHull.bmp' in p['tex'] else 1,
                                         abs(p['tris']-130), -p['tris']))
        best['window'] = face_window(best)
        out[shape] = best
        print(f"  shape {shape} {SHAPE_CODE[shape]}: {len(cands)} exact match(es), "
              f"using {best['rid']} ({best['tris']} tris, window {best['window']}, "
              f"{','.join(best['tex']) or 'no tex'})")
    return out


def decode_variant(path):
    """Later export format: index block first, then a 40-byte vertex
    (pos3, normal3, uv2, pad2) whose normals were never written — they come back
    as 0xCDCDCD debug fill, so they get recomputed from the triangles."""
    d = open(path, 'rb').read()
    pos, subs = 4, []
    while pos < len(d) - 8:
        ic = struct.unpack_from('<I', d, pos)[0]
        if not (3 <= ic <= 200000 and ic % 3 == 0 and pos + 4 + ic*4 <= len(d)):
            pos += 1
            continue
        idx = struct.unpack_from(f'<{ic}I', d, pos + 4)
        iend = pos + 4 + ic*4
        if iend + 8 > len(d):
            break
        vc = struct.unpack_from('<I', d, iend + 4)[0]
        vend = iend + 8 + vc*40
        if not (3 <= vc <= 200000 and vend <= len(d)) or max(idx) >= vc:
            pos += 1
            continue
        vs = iend + 8
        P, UV = [], []
        for i in range(vc):
            f = struct.unpack_from('<8f', d, vs + i*40)
            P.append(f[0:3])
            UV.append(f[6:8])
        # normals from face winding, averaged per vertex
        N = [[0.0, 0.0, 0.0] for _ in range(vc)]
        for t in range(0, ic, 3):
            a, b, c = idx[t], idx[t+1], idx[t+2]
            u = [P[b][k]-P[a][k] for k in range(3)]
            v = [P[c][k]-P[a][k] for k in range(3)]
            n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            for j in (a, b, c):
                for k in range(3):
                    N[j][k] += n[k]
        flat_p, flat_n, flat_uv = [], [], []
        for i in range(vc):
            m = math.sqrt(sum(c*c for c in N[i])) or 1.0
            flat_p += [round(c, 5) for c in P[i]]
            flat_n += [round(c/m, 4) for c in N[i]]
            flat_uv += [round(c, 4) for c in UV[i]]
        subs.append({'tex': sorted({t.rsplit('/', 1)[-1]
                                    for t in _strings(d, 4, pos)}),
                     'pos': flat_p, 'nrm': flat_n, 'uv': flat_uv, 'idx': list(idx)})
        pos = vend
    return {'file': os.path.basename(path), 'declared': struct.unpack_from('<I', d, 0)[0],
            'size': len(d), 'consumed': pos, 'sub': subs, 'normals': 'computed'}


def _hull2d(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def half(ps):
        st = []
        for p in ps:
            while len(st) >= 2 and ((st[-1][0]-st[-2][0])*(p[1]-st[-2][1])
                                    - (st[-1][1]-st[-2][1])*(p[0]-st[-2][0])) <= 1e-9:
                st.pop()
            st.append(p)
        return st[:-1]
    return half(pts) + half(pts[::-1])


def outline(part):
    pts = []
    for s in part['sub']:
        q = s['pos']
        for i in range(0, len(q), 3):
            pts.append((round(q[i], 3), round(q[i+1], 3)))
    h = _hull2d(pts)
    a = 0
    for i in range(len(h)):
        x1, y1 = h[i]
        x2, y2 = h[(i+1) % len(h)]
        a += x1*y2 - x2*y1
    return h, abs(a)/2


def pick_plate_meshes(parts, want_tris=(210, 14)):
    """Decoration plates laid over a frame face: thin, and their outline is the
    face polygon. One square and one triangular representative."""
    out = {}
    for key, target, wanted_area, sides in (('quad', want_tris[0], 1.0, 4),
                                            ('tri', want_tris[1], .5, 3)):
        cands = []
        for p in parts:
            if p['src'] != '_defaults.fbx':
                continue
            zs = [c for s in p['sub'] for c in s['pos'][2::3]]
            if max(zs) - min(zs) >= .6 or max(zs) > .01:
                continue                      # must be a thin slab hanging off z=0
            h, a = outline(p)
            if len(h) == sides and abs(a - wanted_area) < .06:
                cands.append((p, h))
        if not cands:
            continue
        p, h = min(cands, key=lambda c: abs(c[0]['tris'] - target))
        out[key] = {'rid': p['rid'], 'tris': p['tris'], 'tex': p['tex'],
                    'outline': [[round(x, 4), round(y, 4)] for x, y in h],
                    'sub': [{'pos': s['pos'], 'nrm': s['nrm'], 'idx': s['idx']}
                            for s in p['sub']]}
        print(f"  plate {key}: {len(cands)} candidate(s), using {p['rid']} "
              f"({p['tris']} tris, outline {h})")
    return out


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    files = sorted(glob.glob(os.path.join(base, PARTS_DIR, '*.compiled')))
    parts, skipped = [], []
    for p in files:
        m = decode(p)
        if not m['sub']:
            m = decode_variant(p)          # later export: 40-byte vertex, no normals
        if not m['sub']:
            skipped.append((os.path.basename(p), m['size']))
            continue
        lo, hi = bbox(m)
        nv = sum(len(s['pos'])//3 for s in m['sub'])
        nt = sum(len(s['idx'])//3 for s in m['sub'])
        name = os.path.basename(p).replace('.compiled', '')
        src, _, rid = name.rpartition('.')
        parts.append({'name': name, 'src': src or '(unnamed)', 'rid': rid,
                      'verts': nv, 'tris': nt,
                      'size': [round(hi[a]-lo[a], 3) for a in range(3)],
                      'min': [round(lo[a], 3) for a in range(3)],
                      'tex': sorted({t for s in m['sub'] for t in s['tex']}),
                      'sub': m['sub'],
                      'tail': m['size'] - m['consumed']})
        if m.get('normals') != 'computed':
            assert m['declared'] == len(m['sub']), \
                f"{name}: header says {m['declared']} submeshes, found {len(m['sub'])}"
            assert m['size'] - m['consumed'] == 4, f"{name}: unexpected tail"

    parts.sort(key=lambda p: (p['src'], -p['verts']))
    tv = sum(p['verts'] for p in parts)
    tt = sum(p['tris'] for p in parts)
    print(f"decoded {len(parts)}/{len(files)} meshes — {tv} vertices, {tt} triangles")
    for n, sz in skipped:
        print(f"  skipped {n} ({sz} B): no 32-byte submeshes "
              f"(later export, different vertex format / uninitialised normals)")

    os.makedirs(os.path.join(base, 'recovered'), exist_ok=True)
    with open(os.path.join(base, 'recovered', 'parts.json'), 'w') as f:
        json.dump(parts, f, separators=(',', ':'))
    os.makedirs(os.path.join(base, 'viewer'), exist_ok=True)
    with open(os.path.join(base, 'viewer', 'parts.js'), 'w') as f:
        f.write('const PARTS = ')
        json.dump(parts, f, separators=(',', ':'))
        f.write(';\n')
    kb = os.path.getsize(os.path.join(base, 'viewer', 'parts.js')) // 1024
    print(f"wrote recovered/parts.json + viewer/parts.js ({kb} KB)")

    print("matching cube shapes to part meshes by corner set:")
    shapes = pick_shape_meshes(parts)
    slim = {str(k): {'rid': p['rid'], 'tris': p['tris'], 'tex': p['tex'],
                     'code': SHAPE_CODE[k], 'window': p.get('window', 1.0),
                     'sub': [{'pos': s['pos'], 'nrm': s['nrm'], 'idx': s['idx']}
                             for s in p['sub']]}
            for k, p in shapes.items()}
    print("picking decoration plates:")
    plates = pick_plate_meshes(parts)
    with open(os.path.join(base, 'viewer', 'shapes.js'), 'w') as f:
        f.write('const SHAPE_MESH = ')
        json.dump(slim, f, separators=(',', ':'))
        f.write(';\nconst PLATE_MESH = ')
        json.dump(plates, f, separators=(',', ':'))
        f.write(';\n')
    kb = os.path.getsize(os.path.join(base, 'viewer', 'shapes.js')) // 1024
    print(f"wrote viewer/shapes.js ({kb} KB) for {len(slim)}/4 shapes")


if __name__ == '__main__':
    sys.exit(main())
