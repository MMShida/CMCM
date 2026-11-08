/**
 * Seat-block exit plan optimisation (coordinate descent with common random numbers).
 *
 *   npx tsx scripts/optimise-plan.ts --base concert-emergency --seeds 16 --sweeps 3 --out results/plans/opt-A
 *        [--model A|B] [--objective so|ue] [--preassign] [--set key=value ...] [--start plan.json]
 *
 * Blocks are ZONE:SIDE:BAND (src/simulation/Plan.ts). Each block may be sent to the exits on its
 * own side of the hall (floor 1: FOYER, PORTICO_side, STAGE_side; balcony: FOYER, BAL_N side).
 * The plan is used by the Crowd Managers, by the LED strips if enabled, and - with --preassign -
 * also as the exits announced before the show.
 *
 * Objectives
 *   so  "system optimum": minimise the mean evacuation time T_evac (last person out) over the
 *       same K seeds for every candidate (paired comparison, so small differences are meaningful)
 *   ue  "user equilibrium" between blocks: every block in turn switches to the exit that minimises
 *       ITS OWN mean exit time (best response) until no block wants to change. Comparing T_evac of
 *       the two plans measures the cost of self-interested choice at block level.
 *
 * A change is accepted only if it improves the objective by more than --min-gain seconds
 * (default 1 s). Output: <out>.json with the plan, the objective trace and a summary.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assertScope, hashTree } from './research-study';
import { dirname } from 'node:path';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import type { ExitGroupId } from '../src/geometry/types';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import { batchSeeds } from '../src/simulation/MonteCarlo';
import type { SimConfig } from '../src/simulation/Params';
import { expandPlan, planBlocks } from '../src/simulation/Plan';
import { RNG } from '../src/simulation/Random';
import { SCENARIOS, STRATEGIES } from '../src/simulation/Scenarios';
import type { ModelId } from './pool';
import { SimPool } from './pool';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function setPath(obj: any, path: string, value: string) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const old = o[parts[parts.length - 1]];
  o[parts[parts.length - 1]] = typeof old === 'number' ? Number(value) : typeof old === 'boolean' ? value === 'true' : value.startsWith('[') || value.startsWith('{') ? JSON.parse(value) : value;
}

/** exits a block may use: its own side of the hall */
export function candidatesFor(block: string, level: string): ExitGroupId[] {
  const side = block.split(':')[1];
  if (level === 'balcony') return side === 'W' ? ['FOYER', 'BAL_NW'] : ['FOYER', 'BAL_NE'];
  return side === 'W' ? ['FOYER', 'PORTICO_W', 'STAGE_W'] : ['FOYER', 'PORTICO_E', 'STAGE_E'];
}

async function main() {
  const baseId = arg('base', 'concert-emergency')!;
  const K = Number(arg('seeds', '16'));
  const sweeps = Number(arg('sweeps', '3'));
  const model = (arg('model', 'A') as ModelId) ?? 'A';
  const objective = arg('objective', 'so') as 'so' | 'ue';
  const minGain = Number(arg('min-gain', '1'));
  const out = arg('out', `results/plans/opt-${model}-${objective}`)!;
  const def = SCENARIOS.find((s) => s.id === baseId) ?? STRATEGIES.find((s) => s.id === baseId);
  if (!def) throw new Error(`unknown base ${baseId}`);
  const base: SimConfig = arg('config') ? JSON.parse(readFileSync(arg('config')!, 'utf8')) : def.build(BAILEY_HALL);
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--set') {
    const [k, v] = process.argv[i + 1].split('=');
    setPath(base, k, v);
  }
  const geo = BAILEY_HALL;
  const levelOfZone = new Map(geo.zones.map((z) => [z.id, z.level]));
  const blocks = planBlocks(geo);
  let plan: Record<string, ExitGroupId> = arg('start') ? JSON.parse(readFileSync(arg('start')!, 'utf8')).plan : expandPlan(base.crowdManagers.plan, geo);
  const seeds = batchSeeds(Number(arg('seed', '9001')), K);
  if (flag('strict-scope')) assertScope(base);
  mkdirSync(dirname(out), { recursive: true });
  const sourceHash = hashTree('src');
  const pool = new SimPool(Number(arg('workers', '3')));
  const usePre = flag('preassign');
  const cfgFor = (p: Record<string, ExitGroupId>): SimConfig => {
    const c: SimConfig = structuredClone(base);
    c.crowdManagers.plan = { ...p };
    if (c.led.enabled) c.led.plan = { ...p };
    if (usePre) c.preassign = { ...c.preassign, enabled: true, plan: { ...p } };
    return c;
  };
  const cache = new Map<string, RunSummary[]>();
  let evals = 0;
  const evaluate = async (p: Record<string, ExitGroupId>) => {
    const key = JSON.stringify(Object.entries(p).sort());
    let r = cache.get(key);
    if (!r) {
      r = await pool.run(cfgFor(p), seeds, model);
      cache.set(key, r);
      evals++;
      appendFileSync(`${out}-trials.jsonl`, JSON.stringify({ evaluation:evals, sourceHash, cfg:cfgFor(p), seeds, model, runs:r })+'\n');
    }
    return r;
  };
  const tMax = base.tMax;
  const J = (runs: RunSummary[]) => runs.reduce((s, r) => s + (Number.isFinite(r.tEvac) ? r.tEvac : tMax), 0) / runs.length;
  const blockCost = (runs: RunSummary[], b: string) => runs.reduce((s, r) => s + (r.meanExitByBlock?.[b] ?? tMax), 0) / runs.length;
  const t0 = Date.now();
  let cur = await evaluate(plan);
  let curJ = J(cur);
  const trace: { sweep: number; block: string; from: string; to: string; J: number }[] = [];
  console.log(`[${model}/${objective}] start J = ${curJ.toFixed(1)} s over ${K} seeds, ${blocks.length} blocks`);
  const rng = new RNG(4242, 'optimise');
  for (let sw = 1; sw <= sweeps; sw++) {
    let changes = 0;
    const order = blocks.map((b) => b.key);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const b of order) {
      const lvl = levelOfZone.get(b.split(':')[0]) ?? 'orchestra';
      const cands = candidatesFor(b, lvl).filter((g) => g !== plan[b]);
      const trials = await Promise.all(cands.map(async (g) => ({ g, runs: await evaluate({ ...plan, [b]: g }) })));
      let best: { g: ExitGroupId; runs: RunSummary[] } | null = null;
      if (objective === 'so') {
        for (const t of trials) if (J(t.runs) < curJ - minGain && (!best || J(t.runs) < J(best.runs))) best = t;
      } else {
        const own = blockCost(cur, b);
        for (const t of trials) if (blockCost(t.runs, b) < own - minGain && (!best || blockCost(t.runs, b) < blockCost(best.runs, b))) best = t;
      }
      if (best) {
        trace.push({ sweep: sw, block: b, from: plan[b], to: best.g, J: J(best.runs) });
        console.log(`  sweep ${sw}: ${b} ${plan[b]} -> ${best.g}   J ${curJ.toFixed(1)} -> ${J(best.runs).toFixed(1)}  (${evals} evals, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        plan = { ...plan, [b]: best.g };
        cur = best.runs;
        curJ = J(cur);
        changes++;
        writeFileSync(`${out}-checkpoint.json`, JSON.stringify({sourceHash, base, model, seeds, evaluations:evals, plan, trace, runs:cur},null,1));
      }
    }
    console.log(`sweep ${sw}: ${changes} changes, J = ${curJ.toFixed(1)} s`);
    if (!changes) break;
  }
  await pool.close();
  const mean = (f: (r: RunSummary) => number) => cur.reduce((s, r) => s + f(r), 0) / cur.length;
  const summary = {
    meanTEvac: curJ,
    pMeet180: cur.filter((r) => r.tEvac <= 180).length / cur.length,
    meanP95Exit: mean((r) => r.p95Exit),
    meanInsideAt180: mean((r) => r.insideAt180 ?? NaN),
    meanExposure: mean((r) => r.highDensityExposure),
    usage: Object.fromEntries(Object.keys(cur[0].exitGroupUsage).map((g) => [g, mean((r) => r.exitGroupUsage[g] ?? 0)])),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify({ base: baseId, sourceHash, config:cfgFor(plan), model, objective, preassign: usePre, seeds, K, evaluations: evals, wallSeconds: (Date.now() - t0) / 1000, plan, summary, trace, runs:cur }, null, 1));
  console.log(`done: J = ${curJ.toFixed(1)} s, P(T<=180) = ${(summary.pMeet180 * 100).toFixed(0)}%, ${evals} evaluations in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
