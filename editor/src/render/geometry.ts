/* Ship geometry builders — ports of the validated renderer in
   ../viewer/index.html. See ARCHITECTURE.md for mode semantics. */

import type { ShipDoc } from '../core/types';
import type { GameData } from '../data/loader';
import type { BuildOptions, BuiltShip } from './geometryTypes';

export function buildShipGeometry(_doc: ShipDoc, _data: GameData, _opts: BuildOptions): BuiltShip {
  throw new Error('not implemented'); // replaced by the geometry port
}
