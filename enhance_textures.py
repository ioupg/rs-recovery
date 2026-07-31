#!/usr/bin/env python3
"""enhance_textures.py

Derives PBR companion layers (tangent-space normal map + roughness map) for
the decoded 2014 game textures recovered under recovered/textures/*.png, and
writes them alongside a copy (or AI-upscaled version) of the diffuse into
recovered/textures-pbr/.

All filtering is done with periodic (wrap-around) boundary conditions so
outputs stay seamlessly tileable, matching the source textures.

Usage:
    python enhance_textures.py                     # classical pass only
    python enhance_textures.py --ai                 # + Gemini/Nano Banana upscale
    python enhance_textures.py --ai --model MODEL   # override the image model
    python enhance_textures.py --only craftHull.bmp # process a single texture

The --ai stage requires a GEMINI_API_KEY environment variable (or a
".gemini_key" file in the repo root containing just the key). If neither is
present when --ai is given, a one-line note is printed and the run falls
back to the classical-only pipeline. Any per-file AI failure (network error,
bad response, decode error, etc.) falls back to the original diffuse for
that file with a warning -- it never aborts the whole run.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent
SRC_DIR = REPO_ROOT / "recovered" / "textures"
OUT_DIR = REPO_ROOT / "recovered" / "textures-pbr"

DEFAULT_MODEL = "gemini-3-pro-image-preview"
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
AI_PROMPT = (
    "Upscale this seamlessly tiling game texture to 4x resolution. "
    "Preserve the exact panel/seam layout and tiling continuity; sharpen "
    "and add fine surface detail consistent with worn painted metal; no "
    "new objects, no text, no borders."
)

# Textures the AI stage must never touch: the model redraws rather than
# upscales, which corrupts strictly geometric patterns (stripe pitch/angle)
# and semantic colours (the system palette IS data).
AI_SKIP = {"bordersDusty.bmp", "system_colors.png"}

HEIGHT_BLUR_SIGMA = 1.2
NORMAL_STRENGTH = 1.6

# Relief factor per texture. Luminance→height is wrong for PAINT: high-contrast
# painted stripes and palette swatches have no 3D at their colour boundaries,
# so embossing them makes the bump layer visibly fight the diffuse. Structural
# surfaces (rivets, gratings, panel seams) keep full relief.
PER_TEXTURE_RELIEF = {
    "bordersDusty.bmp": 0.15,     # painted hazard stripes
    "system_colors.png": 0.0,     # flat palette — no relief at all
    "MozaicGlowy.bmp": 0.5,       # glossy mosaic — mild
    "wing_solar": 0.4,            # glass cells — gentle
}
ROUGHNESS_BLUR_SIGMA = 2.0
ROUGHNESS_MIN = 0.55
ROUGHNESS_MAX = 1.0


# --------------------------------------------------------------------------
# Wrap-around (circular) filtering helpers -- no scipy, everything periodic
# so it stays exactly tileable.
# --------------------------------------------------------------------------

def shift2(arr: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """Circularly shift a 2D array so that result[y, x] == arr[y+dy, x+dx]
    (indices taken mod H, W)."""
    return np.roll(np.roll(arr, -dy, axis=0), -dx, axis=1)


def gaussian_kernel1d(sigma: float) -> np.ndarray:
    radius = max(1, int(np.ceil(sigma * 3.0)))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    k = np.exp(-(x * x) / (2.0 * sigma * sigma))
    k /= k.sum()
    return k


def blur1d_wrap(arr: np.ndarray, sigma: float, axis: int) -> np.ndarray:
    kernel = gaussian_kernel1d(sigma)
    radius = (len(kernel) - 1) // 2
    out = np.zeros_like(arr, dtype=np.float64)
    for i, w in enumerate(kernel):
        off = i - radius
        if axis == 0:
            out += w * shift2(arr, off, 0)
        else:
            out += w * shift2(arr, 0, off)
    return out


def gaussian_blur2d_wrap(arr: np.ndarray, sigma: float) -> np.ndarray:
    """Separable 2D gaussian blur with periodic (circular) boundary
    handling -- exact wrap, no seam artifacts, no scipy dependency."""
    tmp = blur1d_wrap(arr, sigma, axis=0)
    return blur1d_wrap(tmp, sigma, axis=1)


_SOBEL_X = ((-1, 0, 1), (-2, 0, 2), (-1, 0, 1))
_SOBEL_Y = ((-1, -2, -1), (0, 0, 0), (1, 2, 1))


def _conv3x3_wrap(arr: np.ndarray, kernel) -> np.ndarray:
    out = np.zeros_like(arr, dtype=np.float64)
    for ky in (-1, 0, 1):
        for kx in (-1, 0, 1):
            w = kernel[ky + 1][kx + 1]
            if w != 0:
                out += w * shift2(arr, ky, kx)
    return out


def sobel_wrap(gray: np.ndarray):
    """Sobel gradients (dx, dy) with full periodic wrap -- every column/row,
    including column 0 / the last column, is computed from real neighboring
    (wrapped) data, so there is no seam discontinuity."""
    dx = _conv3x3_wrap(gray, _SOBEL_X)
    dy = _conv3x3_wrap(gray, _SOBEL_Y)
    return dx, dy


def luminance(rgb: np.ndarray) -> np.ndarray:
    """ITU-R BT.601 luma, normalized to 0..1."""
    r = rgb[..., 0].astype(np.float64)
    g = rgb[..., 1].astype(np.float64)
    b = rgb[..., 2].astype(np.float64)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


# --------------------------------------------------------------------------
# PBR layer derivation
# --------------------------------------------------------------------------

def make_height(diffuse: np.ndarray) -> np.ndarray:
    lum = luminance(diffuse)
    return gaussian_blur2d_wrap(lum, HEIGHT_BLUR_SIGMA)


def make_normal_map(dx: np.ndarray, dy: np.ndarray, strength: float = NORMAL_STRENGTH) -> np.ndarray:
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= norm
    ny /= norm
    nz /= norm
    rgb = np.stack([nx, ny, nz], axis=-1)
    rgb = (rgb + 1.0) * 0.5 * 255.0
    return np.clip(rgb, 0, 255).astype(np.uint8)


def make_roughness_map(dx: np.ndarray, dy: np.ndarray) -> np.ndarray:
    edge = np.abs(dx) + np.abs(dy)
    edge_smooth = gaussian_blur2d_wrap(edge, ROUGHNESS_BLUR_SIGMA)
    p99 = np.percentile(edge_smooth, 99)
    denom = p99 if p99 > 1e-8 else 1.0
    e = edge_smooth / denom
    e = np.clip(e, 0.0, 1.0)
    r = np.clip(1.0 - 0.5 * e, ROUGHNESS_MIN, ROUGHNESS_MAX)
    return np.clip(r * 255.0, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# Optional AI upscale stage (Nano Banana / Gemini image model)
# --------------------------------------------------------------------------

def resolve_api_key() -> str | None:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()
    key_file = REPO_ROOT / ".gemini_key"
    if key_file.is_file():
        try:
            text = key_file.read_text(encoding="utf-8").strip()
            return text or None
        except OSError:
            return None
    return None


def tile_2x2(img: Image.Image) -> Image.Image:
    arr = np.array(img.convert("RGB"))
    tiled = np.tile(arr, (2, 2, 1))
    return Image.fromarray(tiled)


def crop_central_quarter(img: Image.Image, target_size: tuple[int, int]) -> Image.Image:
    """Crop the central quarter (half-width x half-height, centered) of the
    returned image, then resample to the expected 4x target size so the
    downstream pipeline always sees a consistent scale factor regardless of
    exactly what the model returned. The central quarter of a 2x2 tiling is
    the original tile PHASE-SHIFTED by half a period, so the result is rolled
    back by half its size — archive UVs were authored against the original
    phase and a half-tile offset reads as a visible wrap on every face."""
    w, h = img.size
    cw, ch = max(1, w // 2), max(1, h // 2)
    x0 = (w - cw) // 2
    y0 = (h - ch) // 2
    cropped = img.crop((x0, y0, x0 + cw, y0 + ch))
    if cropped.size != target_size:
        cropped = cropped.resize(target_size, Image.Resampling.LANCZOS)
    arr = np.array(cropped.convert("RGB"))
    arr = np.roll(arr, (arr.shape[0] // 2, arr.shape[1] // 2), axis=(0, 1))
    return Image.fromarray(arr)


WING_SOLAR_PROMPT = (
    "A perfectly seamless tileable texture, top-down orthographic: a smooth "
    "dark blue-grey photovoltaic glass surface, nearly featureless — an "
    "extremely subtle fine micro-grid of hairline cell lines, barely visible, "
    "low contrast, with a soft satin sheen and faint cell-to-cell tonal "
    "variation. No bold lines, no thick seams, no distinct details, no "
    "reflridge highlights. Flat even lighting, no vignette, no border, no "
    "text, edges must tile seamlessly. 1024x1024."
)


def gemini_generate(prompt: str, model: str, api_key: str) -> Image.Image:
    """Text-to-image via the same Gemini endpoint (no input image)."""
    body = {"contents": [{"parts": [{"text": prompt}]}]}
    url = GEMINI_ENDPOINT.format(model=model, key=api_key)
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    for part in payload["candidates"][0]["content"]["parts"]:
        inline = part.get("inline_data") or part.get("inlineData")
        if inline and inline.get("data"):
            return Image.open(io.BytesIO(base64.b64decode(inline["data"]))).convert("RGB")
    raise RuntimeError("no inline_data image part in Gemini response")


def gemini_upscale(img: Image.Image, model: str, api_key: str) -> Image.Image:
    """Send a 2x2-tiled version of `img` to the Gemini image model and
    return the seamlessness-preserving 4x upscaled tile. Raises on any
    failure -- caller is responsible for falling back."""
    w, h = img.size
    tiled = tile_2x2(img)

    buf = io.BytesIO()
    tiled.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    body = {
        "contents": [
            {
                "parts": [
                    {"text": AI_PROMPT},
                    {"inline_data": {"mime_type": "image/png", "data": b64}},
                ]
            }
        ]
    }

    url = GEMINI_ENDPOINT.format(model=model, key=api_key)
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    parts = payload["candidates"][0]["content"]["parts"]
    b64_out = None
    for part in parts:
        inline = part.get("inline_data") or part.get("inlineData")
        if inline and inline.get("data"):
            b64_out = inline["data"]
            break
    if b64_out is None:
        raise RuntimeError("no inline_data image part in Gemini response")

    out_bytes = base64.b64decode(b64_out)
    returned = Image.open(io.BytesIO(out_bytes)).convert("RGB")
    return crop_central_quarter(returned, (w * 4, h * 4))


# --------------------------------------------------------------------------
# Per-texture processing
# --------------------------------------------------------------------------

def process_one(src_path: Path, use_ai: bool, model: str, api_key: str | None,
                maps_only: bool = False) -> tuple[str, dict]:
    filename = src_path.name
    assert filename.endswith(".png")
    archive_name = filename[: -len(".png")]  # e.g. "craftHull.bmp"

    out_diffuse = OUT_DIR / f"{archive_name}.png"
    out_normal = OUT_DIR / f"{archive_name}_n.png"
    out_rough = OUT_DIR / f"{archive_name}_r.png"

    orig_img = Image.open(src_path).convert("RGB")
    orig_size = orig_img.size

    ai_used = False
    ai_note = ""
    diffuse_img = orig_img

    if archive_name in AI_SKIP:
        use_ai = False
        maps_only = False                     # always re-copy the pristine original
    if maps_only and out_diffuse.exists():
        # regenerate _n/_r only, keeping the (possibly AI-upscaled) diffuse
        diffuse_img = Image.open(out_diffuse).convert("RGB")
        ai_used = diffuse_img.size != orig_size
        use_ai = False
        ai_note = " [maps-only]"
    elif use_ai:
        if not api_key:
            ai_note = " [ai: no key, classical fallback]"
        else:
            try:
                diffuse_img = gemini_upscale(orig_img, model, api_key)
                ai_used = True
            except Exception as exc:  # noqa: BLE001 - any failure must fall back, never abort
                print(f"  [warn] AI upscale failed for {archive_name}: {exc}", file=sys.stderr)
                ai_note = f" [ai: FAILED ({exc}), classical fallback]"
                diffuse_img = orig_img

    # --- diffuse ---
    if maps_only:
        pass                                   # existing diffuse stays untouched
    elif ai_used:
        diffuse_img.save(out_diffuse)
    else:
        shutil.copyfile(src_path, out_diffuse)

    # --- height / gradients at the ORIGINAL feature scale ---
    # Deriving gradients on 4x-upscaled pixels makes low-res sources (64²
    # gratings, 32² balk) read as chunky bas-relief. Compute the maps at the
    # source resolution and upscale them to match the diffuse: structure stays,
    # harshness goes. CRITICAL: the base must be the (possibly AI-upscaled)
    # diffuse DOWNSCALED to source resolution, never the original — the AI
    # redraws fine features, so maps derived from the original would not line
    # up with the rivets/scratches actually visible in the diffuse.
    base_img = (diffuse_img.resize(orig_size, Image.LANCZOS)
                if diffuse_img.size != orig_size else diffuse_img)
    base_arr = np.array(base_img.convert("RGB"))
    height = make_height(base_arr)
    dx, dy = sobel_wrap(height)
    relief = PER_TEXTURE_RELIEF.get(archive_name, 1.0)
    normal_rgb = make_normal_map(dx, dy, NORMAL_STRENGTH * relief)
    rough_gray = make_roughness_map(dx * relief, dy * relief)

    if diffuse_img.size != orig_size:
        normal_up = Image.fromarray(normal_rgb, mode="RGB").resize(diffuse_img.size, Image.LANCZOS)
        # re-normalize the interpolated vectors
        v = np.asarray(normal_up, dtype=np.float32) / 127.5 - 1.0
        norm = np.sqrt((v * v).sum(axis=2, keepdims=True))
        norm[norm < 1e-6] = 1.0
        v /= norm
        normal_rgb = ((v + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
        rough_gray = np.asarray(
            Image.fromarray(rough_gray, mode="L").resize(diffuse_img.size, Image.LANCZOS),
            dtype=np.uint8)

    Image.fromarray(normal_rgb, mode="RGB").save(out_normal)
    Image.fromarray(rough_gray, mode="L").save(out_rough)

    manifest_entry = {"d": True, "n": True, "r": True}

    avg_rgb = normal_rgb.reshape(-1, 3).mean(axis=0)
    rough_mean = rough_gray.mean()
    summary = (
        f"{archive_name}: diffuse {orig_size[0]}x{orig_size[1]}"
        f"{' -> ' + str(diffuse_img.size[0]) + 'x' + str(diffuse_img.size[1]) if ai_used else ' (copied)'}"
        f", normal avg=({avg_rgb[0]:.1f},{avg_rgb[1]:.1f},{avg_rgb[2]:.1f})"
        f", roughness mean={rough_mean:.1f}/255{ai_note}"
    )
    return summary, manifest_entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ai", action="store_true", help="enable the Gemini/Nano Banana AI upscale stage")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Gemini image model (default: {DEFAULT_MODEL})")
    parser.add_argument("--only", default=None, help="process a single texture by archive name (e.g. craftHull.bmp)")
    parser.add_argument("--maps-only", action="store_true",
                        help="regenerate _n/_r from the existing (possibly AI-upscaled) diffuse; never touches diffuse")
    parser.add_argument("--gen-wing", action="store_true",
                        help="generate the synthetic wing_solar texture via the AI (requires key)")
    args = parser.parse_args()

    if not SRC_DIR.is_dir():
        print(f"error: source directory not found: {SRC_DIR}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    api_key = resolve_api_key() if args.ai else None
    if args.ai and not api_key:
        print("[ai] GEMINI_API_KEY not set (env var or .gemini_key file) -- continuing with classical enhancement only.")

    src_files = sorted(
        p for p in SRC_DIR.glob("*.png")
        if not (p.name.endswith("_n.png") or p.name.endswith("_r.png"))
    )

    if args.only:
        wanted = args.only[:-len(".png")] if args.only.endswith(".png") else args.only
        src_files = [p for p in src_files if p.name[: -len(".png")] == wanted]
        if not src_files:
            print(f"error: no texture matching --only {args.only!r} found in {SRC_DIR}", file=sys.stderr)
            return 1

    manifest_path = OUT_DIR / "manifest.json"
    manifest = {}
    if manifest_path.is_file() and args.only:
        # preserve existing entries for other textures when doing a single-file run
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = {}

    if manifest_path.is_file() and (args.maps_only or args.gen_wing):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = {}

    if args.gen_wing:
        key = resolve_api_key()
        if not key:
            print("error: --gen-wing needs the AI key", file=sys.stderr)
            return 1
        img = gemini_generate(WING_SOLAR_PROMPT, args.model, key)
        img.save(OUT_DIR / "wing_solar.png")
        base = np.array(img.convert("RGB"))
        height = make_height(base)
        dx, dy = sobel_wrap(height)
        k = PER_TEXTURE_RELIEF.get("wing_solar", 1.0)
        Image.fromarray(make_normal_map(dx, dy, NORMAL_STRENGTH * k), mode="RGB").save(OUT_DIR / "wing_solar_n.png")
        Image.fromarray(make_roughness_map(dx * k, dy * k), mode="L").save(OUT_DIR / "wing_solar_r.png")
        manifest["wing_solar"] = {"d": True, "n": True, "r": True}
        print(f"wing_solar generated: {img.size[0]}x{img.size[1]}")
    else:
        for src_path in src_files:
            summary, entry = process_one(src_path, args.ai, args.model, api_key,
                                         maps_only=args.maps_only)
            archive_name = src_path.name[: -len(".png")]
            manifest[archive_name] = entry
            print(summary)

    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"manifest written: {manifest_path} ({len(manifest)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
