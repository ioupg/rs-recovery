#!/usr/bin/env python3
"""Decode compiled/textures/*.compiled into recovered/textures/*.png.

Container (validated over all 14 files, byte-exact):
    u32 width ; u32 height ; width*height*4 bytes ; 52-byte trailer

Pixels are RGBA in byte order — bordersDusty decodes to black/yellow hazard
stripes (BGRA would make them teal). The 4th byte is NOT alpha: it is a small
constant per file (7-10) except balk_fragment.png where it is 255; it is
forced to 255 on output. The trailer starts 15 00 00 00 01 00 00 00 01 00 …
on every file and is otherwise unexplained.

Output names keep the full source name so mesh 'tex' references map directly:
    craftHull.bmp.2028245059.compiled -> craftHull.bmp.png
"""
import glob
import os
import struct
import sys

from PIL import Image


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    files = sorted(glob.glob(os.path.join(base, 'compiled', 'textures', '*.compiled')))
    out_dir = os.path.join(base, 'recovered', 'textures')
    os.makedirs(out_dir, exist_ok=True)
    for p in files:
        d = open(p, 'rb').read()
        w, h = struct.unpack_from('<II', d, 0)
        assert len(d) == 8 + w * h * 4 + 52, f'{p}: unexpected size'
        img = Image.frombytes('RGBA', (w, h), d[8:8 + w * h * 4])
        r, g, b, _ = img.split()
        rgb = Image.merge('RGB', (r, g, b))
        # source name without the resource id and .compiled suffix
        stem = os.path.basename(p)
        stem = stem.rsplit('.', 2)[0]          # drop '.<rid>.compiled'
        rgb.save(os.path.join(out_dir, stem + '.png'))
        print(f'{stem + ".png":36} {w}x{h}')
    print(f'wrote {len(files)} textures to recovered/textures/')


if __name__ == '__main__':
    sys.exit(main())
