#!/usr/bin/env python3
"""Generate templates/authoring-template.glb — the to-scale Blender reference
for authoring new RedStar parts (see notes/07-authoring.md).

Geometry is taken verbatim from the editor's data files (already CCW-wound,
cell space [0,1]^3, 1 unit = 1 cell). Stations are spread along +X via node
translations only — zero a node's location in Blender to put its part back
into the authoring cell.

Pure-python glTF 2.0 writer; no dependencies beyond the stdlib.
"""
import json
import struct
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / 'editor' / 'public' / 'data'
OUT = ROOT / 'templates' / 'authoring-template.glb'

# ── glb builder ──────────────────────────────────────────────────────────────

class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.accessors = []
        self.views = []
        self.meshes = []
        self.nodes = []
        self.materials = []
        self.mat_index = {}

    def material(self, name, rgba, *, metallic=0.1, rough=0.8):
        if name in self.mat_index:
            return self.mat_index[name]
        self.materials.append({
            'name': name,
            'pbrMetallicRoughness': {
                'baseColorFactor': list(rgba),
                'metallicFactor': metallic,
                'roughnessFactor': rough,
            },
            'doubleSided': True,
        })
        self.mat_index[name] = len(self.materials) - 1
        return self.mat_index[name]

    def _view(self, data: bytes, target: int) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin.extend(data)
        self.views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
        return len(self.views) - 1

    def _acc_f32(self, floats, ncomp: int) -> int:
        data = struct.pack(f'<{len(floats)}f', *floats)
        view = self._view(data, 34962)
        count = len(floats) // ncomp
        acc = {'bufferView': view, 'componentType': 5126, 'count': count,
               'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[ncomp]}
        if ncomp == 3:  # POSITION requires min/max
            acc['min'] = [min(floats[i::3]) for i in range(3)]
            acc['max'] = [max(floats[i::3]) for i in range(3)]
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def _acc_idx(self, indices) -> int:
        if max(indices, default=0) < 0xFFFF:
            data = struct.pack(f'<{len(indices)}H', *indices)
            ctype = 5123
        else:
            data = struct.pack(f'<{len(indices)}I', *indices)
            ctype = 5125
        view = self._view(data, 34963)
        self.accessors.append({'bufferView': view, 'componentType': ctype,
                               'count': len(indices), 'type': 'SCALAR'})
        return len(self.accessors) - 1

    def mesh(self, name, prims) -> int:
        """prims: list of dicts {pos, idx, mode, material, nrm?, uv?}"""
        out = []
        for p in prims:
            attrs = {'POSITION': self._acc_f32(p['pos'], 3)}
            if p.get('nrm'):
                attrs['NORMAL'] = self._acc_f32(p['nrm'], 3)
            if p.get('uv'):
                attrs['TEXCOORD_0'] = self._acc_f32(p['uv'], 2)
            out.append({'attributes': attrs, 'indices': self._acc_idx(p['idx']),
                        'mode': p.get('mode', 4), 'material': p['material']})
        self.meshes.append({'name': name, 'primitives': out})
        return len(self.meshes) - 1

    def node(self, name, mesh_index, translation=None):
        n = {'name': name, 'mesh': mesh_index}
        if translation and any(translation):
            n['translation'] = list(translation)
        self.nodes.append(n)

    def write(self, path: Path):
        while len(self.bin) % 4:
            self.bin.append(0)
        gltf = {
            'asset': {'version': '2.0', 'generator': 'make_authoring_template.py',
                      'copyright': 'RedStar recovery — authoring reference, 1 unit = 1 cell'},
            'scene': 0,
            'scenes': [{'name': 'authoring-template', 'nodes': list(range(len(self.nodes)))}],
            'nodes': self.nodes,
            'meshes': self.meshes,
            'materials': self.materials,
            'accessors': self.accessors,
            'bufferViews': self.views,
            'buffers': [{'byteLength': len(self.bin)}],
        }
        js = json.dumps(gltf, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942))
            f.write(self.bin)


# ── reference line shapes ────────────────────────────────────────────────────

def box_lines(lo, hi):
    c = [(x, y, z) for z in (lo[2], hi[2]) for y in (lo[1], hi[1]) for x in (lo[0], hi[0])]
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7),
             (0, 4), (1, 5), (2, 6), (3, 7)]
    pos = [v for p in c for v in p]
    idx = [i for e in edges for i in e]
    return pos, idx


def arrow_lines(origin, direction, length):
    ox, oy, oz = origin
    dx, dy, dz = direction
    tip = (ox + dx * length, oy + dy * length, oz + dz * length)
    # two small barbs perpendicular-ish to the shaft
    perp = (dy, dz, dx)  # cheap perpendicular for axis-aligned directions
    b = length * 0.08
    b1 = (tip[0] - dx * b + perp[0] * b, tip[1] - dy * b + perp[1] * b, tip[2] - dz * b + perp[2] * b)
    b2 = (tip[0] - dx * b - perp[0] * b, tip[1] - dy * b - perp[1] * b, tip[2] - dz * b - perp[2] * b)
    pts = [origin, tip, b1, b2]
    pos = [v for p in pts for v in p]
    idx = [0, 1, 1, 2, 1, 3]
    return pos, idx


# ── build ────────────────────────────────────────────────────────────────────

def part_prims(entry, material):
    return [{'pos': s['pos'], 'nrm': s.get('nrm'), 'uv': s.get('uv'),
             'idx': s['idx'], 'material': material} for s in entry['sub']]


def main():
    shape_mesh = json.load(open(DATA / 'shape-mesh.json'))
    plate_mesh = json.load(open(DATA / 'plate-mesh.json'))
    module_mesh = json.load(open(DATA / 'module-mesh.json'))
    wing_mesh = json.load(open(DATA / 'wing-mesh.json'))

    g = Glb()
    m_cell = g.material('ref_cell_bounds', (1, 1, 1, 1))
    m_mod88 = g.material('ref_module_render_bounds', (0.2, 0.9, 0.9, 1))
    m_mount = g.material('ref_plate_mount_face', (1, 0.6, 0.1, 1))
    m_ax = {'X': g.material('ref_axis_X_width', (0.9, 0.15, 0.15, 1)),
            'Y': g.material('ref_axis_Y_height', (0.15, 0.8, 0.15, 1)),
            'Z': g.material('ref_axis_Z_length', (0.2, 0.35, 0.95, 1))}
    m_shell = g.material('shell', (0.62, 0.66, 0.70, 1), metallic=0.2, rough=0.7)
    m_plate = g.material('plate', (0.78, 0.66, 0.45, 1), metallic=0.15, rough=0.75)
    m_module = g.material('module', (0.35, 0.72, 0.68, 1), metallic=0.25, rough=0.6)
    m_wing = g.material('wing', (0.45, 0.52, 0.60, 1), metallic=0.1, rough=0.85)

    pos, idx = box_lines((0, 0, 0), (1, 1, 1))
    cell = g.mesh('REF_cell_bounds', [{'pos': pos, 'idx': idx, 'mode': 1, 'material': m_cell}])

    pad = (1 - 0.88) / 2
    pos, idx = box_lines((pad, pad, pad), (1 - pad, 1 - pad, 1 - pad))
    mod88 = g.mesh('REF_module_render_bounds_088', [{'pos': pos, 'idx': idx, 'mode': 1, 'material': m_mod88}])

    # plate mount face: square on z=0 + relief arrow pointing to -z from its centre
    sq = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]
    sqi = [0, 1, 1, 2, 2, 3, 3, 0]
    apos, aidx = arrow_lines((0.5, 0.5, 0), (0, 0, -1), 0.35)
    mount = g.mesh('REF_plate_mount_face', [
        {'pos': sq + apos, 'idx': sqi + [i + 4 for i in aidx], 'mode': 1, 'material': m_mount}])

    axes = {ax: g.mesh(f'REF_axis_{ax}', [{'pos': p, 'idx': i, 'mode': 1, 'material': m_ax[ax]}])
            for ax, (p, i) in {
                'X': arrow_lines((0, 0, 0), (1, 0, 0), 1.5),
                'Y': arrow_lines((0, 0, 0), (0, 1, 0), 1.5),
                'Z': arrow_lines((0, 0, 0), (0, 0, 1), 1.5)}.items()}

    stations = []  # (x offset, node name, mesh index)

    # station 0 — the master cell: bounds, axes, k8 shell
    stations += [(0, 'CELL_bounds', cell)]
    stations += [(0, f'AXIS_{ax}', axes[ax]) for ax in 'XYZ']
    stations += [(0, 'SHELL_k8', g.mesh('SHELL_k8', part_prims(shape_mesh['0'], m_shell)))]

    # stations 2..6 — the partial shells
    for x, key, code in ((2, '1', 'k7_corner_cut'), (4, '2', 'k6_wedge'), (6, '3', 'k4_tetra')):
        stations += [(x, f'CELL_bounds_{code}', cell),
                     (x, f'SHELL_{code}', g.mesh(f'SHELL_{code}', part_prims(shape_mesh[key], m_shell)))]

    # stations 8..16 — plates in authoring pose
    plates = [(8, 'PLATE_p1111_archive_default', plate_mesh['types']['p1111']),
              (10, 'PLATE_p1111_flat_panel_variant', plate_mesh['quad_all'][1]),
              (12, 'PLATE_p121_tri_default', plate_mesh['types']['p121']),
              (14, 'PLATE_p2121_slope_default', plate_mesh['types']['p2121']),
              (16, 'PLATE_p222A_diag_default', plate_mesh['types']['p222A']),
              (18, 'PLATE_p222V_cut_default', plate_mesh['types']['p222V'])]
    for x, name, entry in plates:
        stations += [(x, f'CELL_bounds_{name[6:]}', cell),
                     (x, f'MOUNT_{name[6:]}', mount),
                     (x, name, g.mesh(name, part_prims(entry, m_plate)))]

    # station 20 — module cage at authored (full-cell) scale + render bounds
    cage = module_mesh[0]
    stations += [(20, 'CELL_bounds_module', cell),
                 (20, 'MODULE_render_bounds_088', mod88),
                 (20, 'MODULE_m1power_authored_full_cell', g.mesh('MODULE_m1power', part_prims(cage, m_module)))]

    # station 22 — wing skin
    wing = wing_mesh[0]
    stations += [(22, 'CELL_bounds_wing', cell),
                 (22, 'WING_w1111_skin', g.mesh('WING_w1111', part_prims(wing, m_wing)))]

    for x, name, mesh_index in stations:
        g.node(name, mesh_index, (x, 0, 0))

    OUT.parent.mkdir(exist_ok=True)
    g.write(OUT)
    print(f'{OUT} — {OUT.stat().st_size:,} bytes, {len(g.nodes)} nodes, '
          f'{len(g.meshes)} meshes, {len(g.materials)} materials')


if __name__ == '__main__':
    main()
