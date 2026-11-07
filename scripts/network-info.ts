/**
 * Prints the network (Model B/C) derived from the detailed geometry, its mapping to the
 * physical features, and writes it as editable/inspectable JSON.
 *   npx tsx scripts/network-info.ts [--json results/network/network.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { BuildingNetwork } from '../src/network/NetworkGraph';
import { scenarioById } from '../src/simulation/Scenarios';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const cfg = scenarioById('concert-emergency');
const net = new BuildingNetwork(BAILEY_HALL, cfg);
console.log(net.stats());
const byKind: Record<string, number> = {};
for (const e of net.edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
console.log('edges by kind', byKind);
console.log('regions', [...new Set(net.nodes.map((n) => n.region))].map((r) => `${r}:${net.nodes.filter((n) => n.region === r).length}`).join(' '));
console.log('sinks', net.sinks.map((s) => net.nodes[s].id).join(' '));
const feats = net.edges.filter((e) => e.feature);
console.log('feature edges', feats.map((e) => `${e.id}(${e.capacity.toFixed(2)}p/s${e.fwd ? '' : ' no-fwd'}${e.bwd ? ' bi' : ''})`).join(' '));
const long = [...net.edges].filter((e) => e.kind !== 'rowExit').sort((a, b) => b.length - a.length).slice(0, 5);
console.log('longest edges', long.map((e) => `${e.id}:${e.length.toFixed(1)}m`).join(' '));
const st = net.nodes.filter((n) => n.kind === 'junction').map((n) => n.storage);
console.log('storage min/median/max', Math.min(...st), st.sort((a, b) => a - b)[st.length >> 1], Math.max(...st));
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        note: 'Derived automatically from src/data/geometry/bailey-hall.json by src/network/NetworkGraph.ts. Edit the geometry JSON, not this file.',
        stats: net.stats(),
        nodes: net.nodes.map(({ idx, id, label, kind, x, y, floor, storage, region, zone, exitGroup }) => ({ idx, id, label, kind, x, y, floor, storage: Number.isFinite(storage) ? storage : null, region, zone, exitGroup })),
        edges: net.edges.map(({ idx, id, label, kind, a, b, fwd, bwd, length, width, capacity, isStair, exterior, accessible, barrierSlot, links, feature, approx }) => ({
          idx,
          id,
          label,
          kind,
          from: net.nodes[a].id,
          to: net.nodes[b].id,
          fwd,
          bwd,
          length: +length.toFixed(2),
          width,
          capacity: +capacity.toFixed(3),
          isStair,
          exterior,
          accessible,
          barrierSlot,
          feature,
          approx,
          detailedLinks: links,
        })),
      },
      null,
      1,
    ),
  );
  console.log('written', jsonOut);
}
