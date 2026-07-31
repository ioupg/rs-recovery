#!/usr/bin/env python3
"""Parser for RedStarEditor .rsconstruction ship files.

Format (reverse-engineered, see notes/02-format-final.md):
    u32 N;  N x 148-byte CarcassCube records;  u32 M;  M x 24-byte element records

Records are raw memory dumps of live editor objects; pointer/padding fields are ignored.
Outputs one JSON per ship plus a combined viewer/ships.js data file.
"""
import glob
import json
import os
import struct
import sys

SHAPE_NAMES = {0: 'cube', 1: 'corner-cut', 2: 'wedge', 3: 'tetra'}
# vertex sets per shape, from exe static table @0x1db7030 (vertexIndex)
SHAPE_CORNERS = {0: [0, 1, 2, 3, 4, 5, 6, 7],
                 1: [0, 1, 3, 4, 5, 6, 7],
                 2: [0, 1, 4, 5, 6, 7],
                 3: [1, 4, 5, 7]}
COMPARTMENTS = {0: 'cargo', 1: 'sys1', 2: 'sys2', 3: 'sys3', 4: 'sys4', 5: 'sys5',
                6: 'engine', 7: 'sys7', 8: 'hull', 9: 'special'}
# Wing types, from RedStar::Wing::verticesCount (exe 0x4428e0) and the vertexIndex
# table at 0x1db7148; names from the pointer table at 0x1db7130. A wing is a flat
# polygon spanning cube corners — the digits of each name are the squared edge
# lengths of that polygon, which is how the tables were confirmed.
WING_NAMES = {0: 'w1111', 1: 'w121', 2: 'w2121', 3: 'w321', 4: 'w222'}
WING_RING = {0: [0, 1, 3, 2], 1: [0, 1, 2], 2: [0, 1, 7, 6], 3: [0, 1, 7], 4: [1, 4, 7]}
# 24 orientation matrices (cube rotation group), from exe initializers @0x4020b0+
ORIENTATIONS = [
    [1,0,0, 0,1,0, 0,0,1],   [1,0,0, 0,0,1, 0,-1,0],  [1,0,0, 0,-1,0, 0,0,-1], [1,0,0, 0,0,-1, 0,1,0],
    [0,0,-1, 0,1,0, 1,0,0],  [0,0,-1, 1,0,0, 0,-1,0], [0,0,-1, 0,-1,0, -1,0,0],[0,0,-1, -1,0,0, 0,1,0],
    [-1,0,0, 0,1,0, 0,0,-1], [-1,0,0, 0,0,-1, 0,-1,0],[-1,0,0, 0,-1,0, 0,0,1], [-1,0,0, 0,0,1, 0,1,0],
    [0,0,1, 0,1,0, -1,0,0],  [0,0,1, -1,0,0, 0,-1,0], [0,0,1, 0,-1,0, 1,0,0],  [0,0,1, 1,0,0, 0,1,0],
    [0,1,0, 0,0,1, 1,0,0],   [0,1,0, 1,0,0, 0,0,-1],  [0,1,0, 0,0,-1, -1,0,0], [0,1,0, -1,0,0, 0,0,1],
    [0,-1,0, 0,0,-1, 1,0,0], [0,-1,0, 1,0,0, 0,0,1],  [0,-1,0, 0,0,1, -1,0,0], [0,-1,0, -1,0,0, 0,0,-1],
]


def parse_file(path):
    d = open(path, 'rb').read()
    n = struct.unpack_from('<I', d, 0)[0]
    assert 4 + n * 148 + 4 <= len(d), f'{path}: truncated'
    cubes = []
    for r in range(n):
        o = 4 + r * 148
        rec = d[o:o + 148]
        orient = rec[0]
        x, y, z = struct.unpack_from('<iii', rec, 4)
        shape = struct.unpack_from('<I', rec, 16)[0]
        compartment = struct.unpack_from('<I', rec, 24)[0]
        flag33 = rec[33]
        eid = struct.unpack_from('<H', rec, 34)[0]
        variant = struct.unpack_from('<I', rec, 36)[0]
        counter = struct.unpack_from('<I', rec, 129)[0]
        # Plate slots, layout settled 2026-07-31 by fleet-wide correlation with
        # face exteriority: six 16-byte axis slots in CUBE-LOCAL order
        # [+x,-x,+y,-y,+z,-z] — {u8 plateOrientation; garbage; u8 noPlate; pad;
        # u32 flag} — plus a compact 7th slot in the tail for the shape's
        # non-axis face (k7 cut / k6 slope / k4 diagonal): orientation @136,
        # present @144. Presence polarity: axis byte@48+16i == 0 means a plate
        # is mounted; tail byte@144 == 1 means mounted.
        slots = []
        for i in range(6):
            b = 40 + 16 * i
            assert rec[b] < 24, f'{path} rec{r} slot{i}: orientation {rec[b]}'
            slots.append({'o': rec[b],
                          'p': 1 if rec[b + 8] == 0 else 0,
                          'f': struct.unpack_from('<I', rec, b + 12)[0] & 1})
        slots.append({'o': rec[136] if rec[136] < 24 else 0,
                      'p': 1 if rec[144] == 1 else 0,
                      'f': 0})
        assert orient < 24, f'{path} rec{r}: orientation {orient}'
        assert shape < 4, f'{path} rec{r}: shape {shape}'
        assert compartment < 10, f'{path} rec{r}: compartment {compartment}'
        cubes.append({'o': orient, 'x': x, 'y': y, 'z': z, 'shape': shape,
                      'comp': compartment, 'id': eid, 'flag': flag33,
                      'variant': variant, 'counter': counter, 'slots': slots})
    to = 4 + n * 148
    m = struct.unpack_from('<I', d, to)[0]
    assert to + 4 + m * 24 == len(d), f'{path}: size mismatch tail'
    elements = []
    for r in range(m):
        o = to + 4 + r * 24
        rec = d[o:o + 24]
        orient = rec[0]
        x, y, z = struct.unpack_from('<iii', rec, 4)
        kind = struct.unpack_from('<I', rec, 16)[0]
        assert orient < 24 and kind < 5, f'{path} elem{r}'
        elements.append({'o': orient, 'x': x, 'y': y, 'z': z, 'kind': kind})
    return {'cubes': cubes, 'elements': elements}


ROSTER = {  # name -> (display, class, rank, nation) from ship-roster.csv
 'm11-scorpion': ('Scorpion', 'корвет', 'I', 'Зелёные'),
 'm11-dragonfly': ('Dragonfly', 'корвет', 'I', 'Зелёные'),
 'm12-dart': ('Dart', 'корвет', 'I', 'Федерация'),
 'm12-punisher': ('Punisher', 'корвет', 'I', 'Орден'),
 'm13-skyche': ('Scyche', 'корвет', 'I', 'независимый'),
 'm12-centurion': ('Centurion', 'канонёрка', 'I', 'Империя'),
 'm14-hound': ('Hound', 'тяжелый корвет', 'I', 'Единение'),
 'm16-rammstain': ('Rammstain', 'эсминец', 'I+', 'Империя'),
 'm16-wasp': ('Wasp', 'эсминец', 'I+', 'Зелёные'),
 'm16-pilum': ('Pilum', 'эсминец', 'I+', 'Федерация'),
 'm17-imp': ('Imp', 'эсминец', 'I+', 'Единение'),
 'm17-inquisitor': ('Inquisitor', 'эсминец', 'I+', 'Орден'),
 'm22-chariot': ('Chariot', 'лёгкий крейсер', 'II', 'Федерация'),
 'm24-machete': ('Machete', 'фрегат', 'II', 'Федерация'),
 'm24-sting': ('Sting', 'фрегат', 'II', 'Зелёные'),
 'm24-foxhound': ('Foxhound', 'лёгкий крейсер', 'II', 'Зелёные'),
 'm24-cavalier-light': ('Cavalier-light', 'фрегат', 'II', 'Империя'),
 'm24-cavalier-heavy': ('Cavalier-heavy', 'фрегат', 'II', 'Империя'),
 'm24-bishop': ('Bishop', 'фрегат', 'II', 'Орден'),
 'm25-cerber': ('Cerber', 'лёгкий крейсер', 'II', 'Единение'),
 'm26-zealot': ('Zealot', 'лидер эсминцев', 'II', 'Орден'),
 'm35-hammer': ('Hammer', 'линейный фрегат', 'III', 'Империя'),
 'm37-excell': ('Excell', 'крейсер', 'III', 'Империя'),
 'm36-escalibur': ('Escalibur', 'крейсер', 'III', 'Орден'),
 'm36-scorpion2': ('Scorpion2', 'крейсер', 'III', 'Зелёные'),
 'm36-horn': ('Horn', 'крейсер', 'III', 'Зелёные'),
 'm36-fang': ('Fang', 'крейсер', 'III', 'Зелёные'),
 'm36-claw': ('Claw', 'рейдер', 'III', 'Зелёные'),
 'm48-normandie': ('Normandie', 'авианосец', 'IV', 'независимый'),
 'm48-legion': ('Legion', 'линейный крейсер', 'IV', 'Империя'),
 'm48-flamberge': ('Flamberge', 'линкор', 'IV', 'Орден'),
 'm48-lucanus': ('Lucanus', 'линкор', 'IV', 'Зелёные'),
 'm48-dunkerke': ('Dunkerke', 'линкор', 'IV', 'Империя'),
 'm52-fenrir': ('Fenrir', 'тяжелый крейсер', 'IV', 'Единение'),
 'm60-werewolf': ('Werewolf', 'линкор', 'V', 'Единение'),
 'm60-durandal': ('Durandal', 'линкор', 'V', 'Орден'),
 'm60-asmodee': ('Asmodee', 'тяжёлый авианосец', 'V', 'Единение'),
 'm62-hand-of-god': ('Hand of God', 'ТДК', 'V', 'Орден'),
 'm72-archangel': ('Archangel', 'дредноут', 'VI', 'Орден'),
 'm72-apocalypse': ('Apocalypse', 'дредноут', 'VI', 'Империя'),
 'c12-light-trader': ('Light Trader', 'торговец', '-', 'гражданский'),
 'm13-tick': ('Tick', '?', '?', '?'),
 'm16-escort': ('Escort', '?', '?', '?'),
}


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(base, 'recovered')
    os.makedirs(out_dir, exist_ok=True)
    ships = {}
    for path in sorted(glob.glob(os.path.join(base, '*.rsconstruction'))):
        name = os.path.basename(path).replace('.rsconstruction', '')
        if name == 'temp':
            continue  # byte-identical to c12-light-trader
        data = parse_file(path)
        meta = ROSTER.get(name, (name, '?', '?', '?'))
        data['name'] = name
        data['display'], data['class'], data['rank'], data['nation'] = meta
        ships[name] = data
        with open(os.path.join(out_dir, name + '.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        print(f"{name:26s} cubes={len(data['cubes']):4d} elements={len(data['elements']):3d}")
    # combined data for the viewer (as JS to work from file://)
    viewer_dir = os.path.join(base, 'viewer')
    os.makedirs(viewer_dir, exist_ok=True)
    with open(os.path.join(viewer_dir, 'ships.js'), 'w', encoding='utf-8') as f:
        f.write('const SHIPS = ')
        json.dump(ships, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\nconst ORIENTATIONS = ')
        json.dump(ORIENTATIONS, f)
        f.write(';\nconst SHAPE_CORNERS = ')
        json.dump(SHAPE_CORNERS, f)
        f.write(';\nconst WING_RING = ')
        json.dump(WING_RING, f)
        f.write(';\nconst WING_NAMES = ')
        json.dump(WING_NAMES, f)
        f.write(';\n')
    print(f"\n{len(ships)} ships -> recovered/*.json + viewer/ships.js")


if __name__ == '__main__':
    sys.exit(main())
