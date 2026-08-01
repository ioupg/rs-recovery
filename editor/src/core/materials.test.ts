import { describe, expect, it, vi } from 'vitest';
import { AssignmentStore, DEFAULT_MATERIALS, MaterialStore, compSlot } from './materials';

describe('AssignmentStore', () => {
  it('defaults every name to itself — the identity resolves to the legacy wrap', () => {
    const s = new AssignmentStore();
    expect(s.get('craftHull.bmp')).toBe('craftHull.bmp');
  });

  it('assign overrides the resolved id; reset clears it back to identity', () => {
    const s = new AssignmentStore();
    s.assign('craftHull.bmp', 'brushed-steel');
    expect(s.get('craftHull.bmp')).toBe('brushed-steel');
    s.reset('craftHull.bmp');
    expect(s.get('craftHull.bmp')).toBe('craftHull.bmp');
  });

  it('assigning a name back to itself clears the override instead of storing an identity entry', () => {
    const s = new AssignmentStore();
    s.assign('craftHull.bmp', 'brushed-steel');
    s.assign('craftHull.bmp', 'craftHull.bmp');
    expect(s.get('craftHull.bmp')).toBe('craftHull.bmp');
    expect(s.diff()).toBeUndefined();
  });

  it('diff is undefined when empty, and otherwise lists only the non-identity overrides', () => {
    const s = new AssignmentStore();
    expect(s.diff()).toBeUndefined();
    s.assign('a.bmp', 'x');
    s.assign('b.bmp', 'y');
    expect(s.diff()).toEqual({ 'a.bmp': 'x', 'b.bmp': 'y' });
  });

  it('load replaces the whole set and ignores identity entries', () => {
    const s = new AssignmentStore();
    s.assign('stale.bmp', 'stale-mat');
    s.load({ 'a.bmp': 'a.bmp', 'b.bmp': 'brushed-steel' });
    expect(s.get('stale.bmp')).toBe('stale.bmp');          // prior state cleared
    expect(s.get('a.bmp')).toBe('a.bmp');                  // identity entry not stored...
    expect(s.get('b.bmp')).toBe('brushed-steel');
    expect(s.diff()).toEqual({ 'b.bmp': 'brushed-steel' }); // ...proven by diff omitting it
  });

  it('load(undefined) clears the set', () => {
    const s = new AssignmentStore();
    s.assign('a.bmp', 'x');
    s.load(undefined);
    expect(s.diff()).toBeUndefined();
  });

  it('subscribe fires on assign/reset/load; unsubscribe stops further notifications', () => {
    const s = new AssignmentStore();
    const fn = vi.fn();
    const unsub = s.subscribe(fn);
    s.assign('a.bmp', 'x');
    s.reset('a.bmp');
    s.load({ 'b.bmp': 'y' });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenCalledWith('materials');
    unsub();
    s.assign('c.bmp', 'z');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// MaterialStore itself is unchanged by the refactor and already has broad
// coverage in systems.test.ts (registry-driven slots, setDefaults). These
// round out the plain store operations that weren't exercised there.
describe('MaterialStore (additional cheap coverage)', () => {
  it('patch merges into one slot without touching others; diff reports only changed slots', () => {
    const s = new MaterialStore();
    expect(s.diff()).toBeUndefined();
    s.patch(compSlot(0), { roughness: 0.1 });
    expect(s.get(compSlot(0)).roughness).toBe(0.1);
    expect(s.get(compSlot(0)).color).toBe(DEFAULT_MATERIALS[compSlot(0)].color);
    expect(s.get(compSlot(1))).toEqual(DEFAULT_MATERIALS[compSlot(1)]);
    expect(s.diff()).toEqual({ [compSlot(0)]: { ...DEFAULT_MATERIALS[compSlot(0)], roughness: 0.1 } });
  });

  it('resetSlot reverts a single slot to its default and drops it from diff', () => {
    const s = new MaterialStore();
    s.patch(compSlot(1), { metalness: 0.99 });
    s.resetSlot(compSlot(1));
    expect(s.get(compSlot(1))).toEqual(DEFAULT_MATERIALS[compSlot(1)]);
    expect(s.diff()).toBeUndefined();
  });

  it('load() applies full-slot overrides on top of defaults', () => {
    const s = new MaterialStore();
    s.load({ [compSlot(0)]: { ...DEFAULT_MATERIALS[compSlot(0)], color: '#123456' } });
    expect(s.get(compSlot(0)).color).toBe('#123456');
    expect(s.get(compSlot(0)).roughness).toBe(DEFAULT_MATERIALS[compSlot(0)].roughness);
  });

  it('load() keeps an override slot unknown to the current registry (fed a bigger doc)', () => {
    const s = new MaterialStore();
    s.load({
      comp99: { color: '#abcdef', roughness: 0.3, metalness: 0.2, emissive: '#000000', emissiveIntensity: 0, clearcoat: 0, clearcoatRoughness: 0 },
    });
    expect(s.get('comp99').color).toBe('#abcdef');
  });
});
