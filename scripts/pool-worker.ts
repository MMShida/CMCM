import { parentPort } from 'node:worker_threads';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { runNetworkSimulation } from '../src/network/NetworkSimulation';
import { toRunSummary } from '../src/simulation/MonteCarlo';
import { runSimulation } from '../src/simulation/SimulationEngine';

import type { GeometryData } from '../src/geometry/types';

/** geometry variants: link id -> overrides (width, lanes); cached per patch */
const geoCache = new Map<string, GeometryData>();
function geometry(patch?: Record<string, { width?: number; lanes?: number }>): GeometryData {
  if (!patch || !Object.keys(patch).length) return BAILEY_HALL;
  const key = JSON.stringify(patch);
  let g = geoCache.get(key);
  if (!g) {
    g = structuredClone(BAILEY_HALL);
    for (const l of g.links) {
      const o = patch[l.id];
      if (!o) continue;
      if (o.width !== undefined) l.width = o.width;
      if (o.lanes !== undefined) l.lanes = o.lanes;
    }
    geoCache.set(key, g);
  }
  return g;
}

parentPort!.on('message', (m: { id: number; cfg: any; seed: number; model: 'A' | 'B'; geoPatch?: Record<string, { width?: number; lanes?: number }> }) => {
  try {
    const geo = geometry(m.geoPatch);
    const r = m.model === 'B' ? runNetworkSimulation(geo, m.cfg, m.seed).result : runSimulation(geo, m.cfg, m.seed);
    parentPort!.postMessage({ id: m.id, summary: toRunSummary(r) });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: String((e as Error)?.stack ?? e) });
  }
});
