/**
 * Model C on the command line: static max flow / min cut and the time-expanded benchmark.
 *   npx tsx scripts/flow-network.ts [--scenario concert-emergency] [--dt 1]
 */
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { networkFor } from '../src/network/NetworkGraph';
import { blockingEffects, flowReport } from '../src/network/StaticFlow';
import { releasesFromPopulation, timeExpandedFlow } from '../src/network/TimeExpanded';
import { createPopulation } from '../src/simulation/Population';
import { scenarioById } from '../src/simulation/Scenarios';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const cfg = scenarioById(opt('scenario', 'concert-emergency'));
const dt = Number(opt('dt', '1'));
const geo = BAILEY_HALL;
const rep = flowReport(geo, cfg);
const N = 1329;
console.log(`network: ${JSON.stringify(rep.net.stats())}`);
console.log(`static max flow (row ends limit supply): F* = ${rep.all.maxFlow.toFixed(2)} p/s; required for 180 s: ${(N / 180).toFixed(2)} p/s; N/F* = ${rep.all.flowTime.toFixed(0)} s`);
console.log(`  min cut (${rep.all.cutCapacity.toFixed(2)} p/s): ${rep.all.cut.map((c) => `${c.label}[${c.region}] ${c.capacity.toFixed(2)}`).join(', ')}`);
console.log(`building only (unlimited supply): F* = ${rep.building.maxFlow.toFixed(2)} p/s; cut: ${rep.building.cut.map((c) => c.label).join(', ')}`);
for (const l of rep.byLevel) console.log(`  ${l.level}: F* = ${l.maxFlow.toFixed(2)} p/s; cut: ${l.cut.map((c) => c.label).join(', ')}`);
const be = blockingEffects(rep.net, cfg, N);
console.log(`blocking (most harmful first): ${be.effects.slice(0, 10).map((e) => `${e.label} ${e.delta.toFixed(2)}`).join(', ')}`);

const net = networkFor(geo, cfg);
const pop = createPopulation(geo, cfg, 1);
const imm = releasesFromPopulation(net, cfg, pop.agents.map((a) => ({ seat: a.seat, tDepart: 0 })));
const r0 = timeExpandedFlow(net, cfg, imm, { dt });
console.log(`time-expanded, immediate departure: T* = ${r0.tStar} s (${r0.layers} layers, ${r0.arcs} arcs, ${r0.wallTimeMs} ms); discretisation error mean ${r0.discretisation.meanAbsError.toFixed(2)} s, max ${r0.discretisation.maxAbsError.toFixed(2)} s`);
console.log('  exit usage', r0.exitUsage);
const pre = releasesFromPopulation(net, cfg, pop.agents.map((a) => ({ seat: a.seat, tDepart: a.tRecognition + a.tResponse + a.tPrepare })));
const r1 = timeExpandedFlow(net, cfg, pre, { dt });
console.log(`time-expanded, sampled pre-movement (no social influence): T* = ${r1.tStar} s (${r1.wallTimeMs} ms); last release ${Math.max(...pre.map((p) => p.t)).toFixed(0)} s`);
const r2 = timeExpandedFlow(net, cfg, imm, { dt, storage: false });
console.log(`  immediate, no storage limits: T* = ${r2.tStar} s`);
