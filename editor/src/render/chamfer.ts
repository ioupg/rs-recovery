/* Chamfer (viewer 266-363): inset every exterior facet inside its own plane,
   then close the gaps with bevel strips along shared edges and fan patches at
   the corners. Interior edges never appear here because coincident facets were
   already culled. Source-solid centroids (`sc`) propagate so the strips stay
   orientable — averaged across the two parents of a bevel, inherited by flaps,
   averaged over the ring for a corner patch. */

import { add, cross, len, mul, sub, vkey, type Facet, type V3 } from './facets';

interface Inset extends Facet { iv: V3[] }
interface Use { fi: number; i: number; j: number }

export function chamferFaces(kept: readonly Facet[], b: number): Facet[] {
  /* 1 — inset each facet within its own plane */
  const F: Inset[] = kept.map(f => {
    const n = f.verts.length;
    const c = mul(f.verts.reduce<V3>((s, v) => add(s, v), [0, 0, 0]), 1 / n);
    let dmin = Infinity;
    for (let i = 0; i < n; i++) {
      const a = f.verts[i], e = sub(f.verts[(i + 1) % n], a);
      dmin = Math.min(dmin, len(cross(e, sub(c, a))) / (len(e) || 1));
    }
    const t = Math.min(b / dmin, 0.4);
    return { ...f, iv: f.verts.map(v => add(v, mul(sub(c, v), t))) };
  });

  /* 2 — index edges and vertex incidences */
  const E = new Map<string, Use[]>();
  const VI = new Map<string, { fi: number; li: number }[]>();
  F.forEach((f, fi) => {
    const n = f.verts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ek = [vkey(f.verts[i]), vkey(f.verts[j])].sort().join('|');
      const eu = E.get(ek) ?? E.set(ek, []).get(ek)!;
      eu.push({ fi, i, j });
      const vk = vkey(f.verts[i]);
      const vu = VI.get(vk) ?? VI.set(vk, []).get(vk)!;
      vu.push({ fi, li: i });
    }
  });

  const out: Facet[] = F.map(f => ({
    verts: f.iv, comp: f.comp, shape: f.shape, k: f.k, sc: f.sc,
  }));

  /* 3 — bevel strip per manifold edge; elsewhere (open or non-manifold edges,
        where a wedge slope abuts a cube plate) drop a flap back to the original
        edge so the inset never tears a hole in the hull */
  for (const [, uses] of E) {
    if (uses.length === 2) {
      const [A, B] = uses, fa = F[A.fi], fb = F[B.fi];
      const at = (k: string): number => fb.verts.findIndex(v => vkey(v) === k);
      const bi = at(vkey(fa.verts[A.i])), bj = at(vkey(fa.verts[A.j]));
      if (bi >= 0 && bj >= 0) {
        out.push({
          verts: [fa.iv[A.i], fa.iv[A.j], fb.iv[bj], fb.iv[bi]],
          comp: fa.comp, shape: fa.shape, k: 'b' + fa.k + A.i, plain: true,
          sc: fa.sc && fb.sc
            ? [(fa.sc[0] + fb.sc[0]) / 2, (fa.sc[1] + fb.sc[1]) / 2, (fa.sc[2] + fb.sc[2]) / 2]
            : undefined,
        });
        continue;
      }
    }
    for (const U of uses) {
      const f = F[U.fi];
      out.push({
        verts: [f.iv[U.i], f.iv[U.j], f.verts[U.j], f.verts[U.i]],
        comp: f.comp, shape: f.shape, k: 'f' + f.k + U.i, plain: true, sc: f.sc,
      });
    }
  }

  /* 4 — corner patch per vertex: walk the facet ring through shared edges */
  for (const [vkStr, inc] of VI) {
    if (inc.length < 3) continue;
    const seen = new Set<number>();
    /* → neighbouring facet across one edge at V */
    const step = (fi: number, li: number, dir: number): { fi: number; li: number } | null => {
      const f = F[fi], n = f.verts.length;
      const o = dir > 0 ? (li + 1) % n : (li - 1 + n) % n;
      const ek = [vkey(f.verts[li]), vkey(f.verts[o])].sort().join('|');
      const uses = E.get(ek);
      if (!uses || uses.length !== 2) return null;
      const nfi = uses[0].fi === fi ? uses[1].fi : uses[0].fi;
      const nli = F[nfi].verts.findIndex(v => vkey(v) === vkStr);
      return nli < 0 ? null : { fi: nfi, li: nli };
    };
    for (const start of inc) {
      if (seen.has(start.fi)) continue;
      const ring = [start];
      let cur = start, closed = false;
      for (let guard = 0; guard < 12; guard++) {           // forward
        const nx = step(cur.fi, cur.li, +1);
        if (!nx) break;
        if (nx.fi === start.fi) { closed = true; break; }
        if (ring.some(r => r.fi === nx.fi)) break;
        ring.push(nx); cur = nx;
      }
      if (!closed) {                                       // open fan → backwards
        cur = start;
        for (let guard = 0; guard < 12; guard++) {
          const pv = step(cur.fi, cur.li, -1);
          if (!pv || ring.some(r => r.fi === pv.fi)) break;
          ring.unshift(pv); cur = pv;
        }
      }
      ring.forEach(r => seen.add(r.fi));
      if (ring.length < 3) continue;
      const scs = ring.map(r => F[r.fi].sc).filter((s): s is V3 => !!s);
      out.push({
        verts: ring.map(r => F[r.fi].iv[r.li]),
        comp: F[ring[0].fi].comp, shape: F[ring[0].fi].shape,
        k: 'c' + vkStr, plain: true,
        sc: scs.length === ring.length
          ? (mul(scs.reduce<V3>((a, s) => add(a, s), [0, 0, 0]), 1 / scs.length) as V3)
          : undefined,
      });
    }
  }
  return out;
}
