/* Render-on-demand: anything that changes what the next frame should look
   like calls requestFrame(); the main loop consumes the flag and skips ALL
   GPU work (SSAO chain, shadow pass, main render) while it stays clear. An
   idle tab then costs nothing — the rAF ticks, sees no debt, and returns.

   Module-level shared state, like ssao.ts's uniforms: there is exactly one
   main loop per app. Everything routes through a handful of funnels —
   viewport input, ShipView mutations, MaterialCache.refreshAll, texture
   loads, env/tuning changes — each of which calls requestFrame(). */

let dirty = true;

export function requestFrame(): void {
  dirty = true;
}

/** main loop only: whether a frame is owed; clears the debt */
export function consumeFrame(): boolean {
  const d = dirty;
  dirty = false;
  return d;
}
