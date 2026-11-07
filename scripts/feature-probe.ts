/**
 * Feature audit by experiment: for each behavioural / physical feature, run both models with the
 * feature switched low and high on the same seeds and report whether the expected metric responds.
 * A feature counts as "verified" only if it changes the metric in the expected direction.
 *   npx tsx scripts/feature-probe.ts [--seeds 3] [--out docs/feature-probe.json]
 */
import { writeFileSync } from 'node:fs';
import { runModelA, runModelB } from '../src/compare/Comparison';
import type { ModelRun } from '../src/compare/Comparison';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import type { SimConfig } from '../src/simulation/Params';
import { cloneConfig } from '../src/simulation/Params';
import { batchSeeds } from '../src/simulation/Random';
import { scenarioById } from '../src/simulation/Scenarios';

const args = process.argv.slice(2);
const nSeeds = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 3;
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/feature-probe.json';
const seeds = batchSeeds(4242, nSeeds);
const base = scenarioById('concert-emergency');

interface Probe {
  feature: string;
  low: string;
  high: string;
  metric: string;
  expect: 'up' | 'down';
  set: (c: SimConfig, high: boolean) => void;
  value: (r: ModelRun) => number;
  cfg?: () => SimConfig;
}

const share = (c: SimConfig, type: keyof SimConfig['population']['typeShares'], v: number) => {
  const s = c.population.typeShares;
  const rest = 1 - s[type];
  for (const k of Object.keys(s) as (keyof typeof s)[]) if (k !== type) s[k] *= rest > 0 ? (1 - v) / rest : 0;
  s[type] = v;
};
const usage = (g: string) => (r: ModelRun) => r.exitGroupUsage[g] ?? 0;

const PROBES: Probe[] = [
  { feature: 'Individual pre-movement delays (lognormal)', low: 'recognition median 3 s', high: '12 s', metric: 'median start time (s)', expect: 'up', set: (c, h) => (c.premovement.recognitionMedian = h ? 12 : 3), value: (r) => r.medianStart },
  { feature: 'Social influence on pre-movement', low: 'kappa 0, hazard 0', high: 'kappa 3, hazard 1', metric: 'p95 start time (s)', expect: 'down', set: (c, h) => ((c.premovement.socialKappa = h ? 3 : 0), (c.premovement.socialAwareRate = h ? 1 : 0)), value: (r) => r.p95Start },
  { feature: 'Social groups (waiting for members)', low: 'group fraction 0', high: '0.8', metric: 'median start time (s)', expect: 'up', set: (c, h) => (c.population.groupFraction = h ? 0.8 : 0), value: (r) => r.medianStart },
  { feature: 'Seat-row clearance', low: 'row speed 0.8 m/s', high: '0.25 m/s', metric: 'mean exit time (s)', expect: 'up', set: (c, h) => (c.movement.rowSpeed = h ? 0.25 : 0.8), value: (r) => r.meanExit },
  { feature: 'Randomised walking speeds', low: 'mean 1.4 m/s', high: '0.9 m/s', metric: 'mean exit time (s)', expect: 'up', set: (c, h) => (c.population.speedMean = h ? 0.9 : 1.4), value: (r) => r.meanExit },
  { feature: 'Doorway / stair bottlenecks (capacity)', low: 'door 1.9, stair 1.3 p/(s m)', high: 'door 0.7, stair 0.6', metric: 'evacuation time (s)', expect: 'up', set: (c, h) => ((c.movement.doorFlow = h ? 0.7 : 1.9), (c.movement.stairFlow = h ? 0.6 : 1.3)), value: (r) => r.tEvac },
  { feature: 'Familiar-exit (habit) preference', low: 'familiarity weights x0', high: 'x2.5', metric: 'persons using the foyer', expect: 'up', set: (c, h) => Object.values(c.routing.weights).forEach((w) => (w.familiarity *= h ? 2.5 : 0)), value: usage('FOYER') },
  { feature: 'Crowd Manager guidance (compliance)', low: 'compliance 0', high: '1', metric: 'persons using the foyer (plan sends most side zones elsewhere)', expect: 'down', set: (c, h) => (c.crowdManagers.complianceProb = h ? 1 : 0), value: usage('FOYER') },
  {
    feature: 'LED guidance (compliance)',
    low: 'compliance 0',
    high: '1',
    metric: 'persons using the foyer',
    expect: 'down',
    cfg: () => {
      const c = cloneConfig(base);
      c.crowdManagers.count = 0;
      c.led.enabled = true;
      return c;
    },
    set: (c, h) => (c.led.complianceProb = h ? 1 : 0),
    value: usage('FOYER'),
  },
  { feature: 'Queue avoidance', low: 'queue-avoider share 0', high: '0.7', metric: 'exit imbalance max/mean', expect: 'down', set: (c, h) => share(c, 'queueAvoider', h ? 0.7 : 0), value: (r) => r.exitImbalance },
  { feature: 'Social following (imitation)', low: 'social weights x0', high: 'x3', metric: 'exit imbalance max/mean', expect: 'up', set: (c, h) => Object.values(c.routing.weights).forEach((w) => (w.social *= h ? 3 : 0)), value: (r) => r.exitImbalance },
  {
    feature: 'Blocked-exit discovery and rerouting',
    low: 'no closure',
    high: 'FC2 blocked (discovered)',
    metric: 'agents who rerouted',
    expect: 'up',
    set: (c, h) => ((c.blocked.links = h ? ['FC2'] : []), (c.blocked.knowledge = 'discovery')),
    value: (r) => r.reroutedAgents,
  },
  {
    feature: 'Impatience / faster-is-slower at gates',
    low: 'impatient share 0',
    high: '0.8 with strong clogging (drop 0.9)',
    metric: 'evacuation time (s)',
    expect: 'up',
    set: (c, h) => {
      share(c, 'impatient', h ? 0.8 : 0);
      c.movement.urgency = 1;
      c.movement.fasterIsSlower = { enabled: true, gain: 0.15, drop: 0.9, threshold: 0.35 };
    },
    value: (r) => r.tEvac,
  },
];

const rows: Record<string, unknown>[] = [];
for (const p of PROBES) {
  const res: Record<string, number[]> = { A0: [], A1: [], B0: [], B1: [] };
  for (const s of seeds)
    for (const h of [false, true]) {
      const c = cloneConfig(p.cfg ? p.cfg() : base);
      p.set(c, h);
      res[`A${h ? 1 : 0}`].push(p.value(runModelA(BAILEY_HALL, c, s).run));
      res[`B${h ? 1 : 0}`].push(p.value(runModelB(BAILEY_HALL, c, s).run));
    }
  const m = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const verdict = (lo: number[], hi: number[]) => {
    const d = lo.map((x, i) => hi[i] - x);
    const ok = d.every((x) => (p.expect === 'up' ? x > 0 : x < 0));
    const mostly = d.filter((x) => (p.expect === 'up' ? x > 0 : x < 0)).length >= Math.ceil(d.length / 2) && (p.expect === 'up' ? m(d) > 0 : m(d) < 0);
    return ok ? 'verified' : mostly ? 'weak (not every seed)' : 'NOT verified';
  };
  const row = {
    feature: p.feature,
    low: p.low,
    high: p.high,
    metric: p.metric,
    expected: p.expect,
    A_low: +m(res.A0).toFixed(2),
    A_high: +m(res.A1).toFixed(2),
    A_verdict: verdict(res.A0, res.A1),
    B_low: +m(res.B0).toFixed(2),
    B_high: +m(res.B1).toFixed(2),
    B_verdict: verdict(res.B0, res.B1),
  };
  rows.push(row);
  console.log(`${p.feature}: A ${row.A_low} -> ${row.A_high} (${row.A_verdict}); B ${row.B_low} -> ${row.B_high} (${row.B_verdict})`);
}
writeFileSync(out, JSON.stringify({ seeds, scenario: base.scenarioId, rows }, null, 1));
console.log('written', out);
