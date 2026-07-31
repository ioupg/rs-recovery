/* The single source of truth for tools and view modes: ids, icons, shortcuts,
   and the view mode a tool needs to be usable. Header buttons, the keymap and
   the contextual panel all read this table. */

import type { RenderMode } from '../render/geometryTypes';
import type { Tool } from './state';

export interface ToolDef {
  id: Tool;
  name: string;
  icon: string;
  key: string;
  /** the tool edits state only visible in this mode → auto-switch + restore */
  needsMode?: RenderMode;
  hint: string;
}

export const TOOL_DEFS: readonly ToolDef[] = [
  { id: 'select', name: 'Select', icon: '⬚', key: '1',
    hint: 'click select · Shift add · drag move (Shift = vertical) · Del delete' },
  { id: 'build', name: 'Build', icon: '🧱', key: '2',
    hint: 'click place · Q/E item · R orient · X/C/V rotate · Alt+X/C/V mirror' },
  { id: 'erase', name: 'Erase', icon: '✕', key: '3',
    hint: 'click a block or wing to remove it' },
  { id: 'systems', name: 'Systems', icon: '⚙', key: '4', needsMode: 'naked',
    hint: 'click a block to assign the active system · Q/E cycle system' },
  { id: 'plate', name: 'Plates', icon: '▦', key: '5', needsMode: 'mesh',
    hint: 'click a face to mount/remove · R spin · pick mesh in the panel' },
];

export const toolDef = (id: Tool): ToolDef => TOOL_DEFS.find(t => t.id === id)!;

export interface ModeDef { id: RenderMode; name: string; key: string; hint: string }

export const MODE_DEFS: readonly ModeDef[] = [
  { id: 'box', name: 'Box', key: '7', hint: 'fast editing view — flat blocks' },
  { id: 'plate', name: 'Panels', key: '8', hint: 'blocks with the panel atlas' },
  { id: 'mesh', name: 'Mesh', key: '9', hint: 'full dressed hull — shells, plates, textures' },
  { id: 'naked', name: 'Systems', key: '0', hint: 'internal systems view — cages over the hull wireframe' },
];
