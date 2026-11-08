/**
 * Tests for the model improvements of 2026-11-07 (see docs/IMPROVEMENTS.md):
 * seat-block plans, door-as-goal routing, time-step independence, pre-assigned exits, Crowd
 * Manager posts and queue rebalancing, voice alarm, groups meeting outside, responders,
 * counterflow sharing in Model B, the Model C individual bound and pre-movement budget, and
 * the tail metrics.
 */
import { describe, expect, it } from 'vitest';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { EXIT_GROUPS } from '../src/geometry/types';
import { networkFor } from '../src/network/NetworkGraph';
import { NetworkSimulation, runNetworkSimulation } from '../src/network/NetworkSimulation';
import { individualBound, premovementBudget, timeExpandedFlow, releasesFromPopulation } from '../src/network/TimeExpanded';
import { benchmarkPeople } from '../src/compare/Comparison';
import { DEFAULT_PLAN, defaultConfig, mergeConfig } from '../src/simulation/Params';
import type { SimConfig } from '../src/simulation/Params';
import { expandPlan, planBlocks, planExitName, seatPlanKeys } from '../src/simulation/Plan';
import { createPopulation } from '../src/simulation/Population';
import { GateSystem } from '../src/simulation/QueueSystem';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine, runSimulation } from '../src/simulation/SimulationEngine';

const geo = BAILEY_HALL;

describe('seat-block exit plans', () => {
  it('the most specific key wins: ZONE:SIDE:BAND > ZONE:SIDE > ZONE', () => {
    const seat = geo.seats.findIndex((s) => s.zone === 'ORCH_C_FRONT' && s.x < 0);
    const keys = seatPlanKeys(geo, seat);
    expect(keys[1]).toBe('ORCH_C_FRONT:W');
    expect(keys[2]).toBe('ORCH_C_FRONT');
    expect(planExitName({ ORCH_C_FRONT: 'FOYER' }, geo, seat)).toBe('FOYER');
    expect(planExitName({ ORCH_C_FRONT: 'FOYER', 'ORCH_C_FRONT:W': 'PORTICO_W' }, geo, seat)).toBe('PORTICO_W');
    expect(planExitName({ 'ORCH_C_FRONT:W': 'PORTICO_W', [keys[0]]: 'STAGE_W' }, geo, seat)).toBe('STAGE_W');
    expect(planExitName({}, geo, seat)).toBe('FOYER');
  });

  it('expanding the zone-level default plan reproduces it for every seat', () => {
    const blocks = planBlocks(geo);
    expect(blocks.reduce((s, b) => s + b.seats, 0)).toBe(geo.seats.length);
    const ex = expandPlan(DEFAULT_PLAN, geo);
    expect(Object.keys(ex).length).toBe(blocks.length);
    geo.seats.forEach((s, i) => expect(planExitName(ex, geo, i)).toBe(DEFAULT_PLAN[s.zone] ?? 'FOYER'));
  });
});

describe('routing: the exterior door is the goal (as in Models B and C)', () => {
  it('front-of-house portico doors P1/P4 are used once the outdoor walk is not counted in full', () => {
    const near = mergeConfig(scenarioById('concert-emergency'), { routing: { outdoorWeight: 0.2 } });
    const street = mergeConfig(scenarioById('concert-emergency'), { routing: { outdoorWeight: 1 } });
    let pNear = 0;
    let pStreet = 0;
    for (const s of [1, 2]) {
      const a = runSimulation(geo, near, s);
      const b = runSimulation(geo, street, s);
      pNear += (a.exitDoorUsage['P1'] ?? 0) + (a.exitDoorUsage['P4'] ?? 0);
      pStreet += (b.exitDoorUsage['P1'] ?? 0) + (b.exitDoorUsage['P4'] ?? 0);
      expect(a.allLeftBuilding).toBe(true);
    }
    expect(pNear).toBeGreaterThan(pStreet + 40);
  });
});

describe('time-step independence', () => {
  it('halving dt does not change the mean evacuation time beyond noise', () => {
    const c1 = scenarioById('concert-emergency');
    const c2 = mergeConfig(c1, { movement: { dt: 0.05 } });
    const seeds = [11, 12, 13, 14, 15, 16];
    const m1 = seeds.reduce((s, k) => s + runSimulation(geo, c1, k).tEvac, 0) / seeds.length;
    const m2 = seeds.reduce((s, k) => s + runSimulation(geo, c2, k).tEvac, 0) / seeds.length;
    expect(Math.abs(m1 - m2)).toBeLessThan(25);
  }, 120000);
});

describe('pre-assigned exits', () => {
  const plan = { ...DEFAULT_PLAN, 'ORCH_C_FRONT:W': 'PORTICO_W' as const, 'ORCH_C_FRONT:E': 'PORTICO_E' as const };
  const cfg = mergeConfig(scenarioById('concert-emergency'), { preassign: { enabled: true, plan, reachProb: 0.6, complianceProb: 0.7 } });

  it('reach and compliance shares match the configuration, and the exit is known at t = 0', () => {
    const sim = new SimulationEngine(geo, cfg, 3);
    const block = sim.agents.filter((a) => geo.seats[a.seat].zone === 'ORCH_C_FRONT' && geo.seats[a.seat].x < 0);
    const pw = EXIT_GROUPS.indexOf('PORTICO_W');
    const adopted = block.filter((a) => a.assignGroup === pw).length / block.length;
    expect(adopted).toBeGreaterThan(0.2);
    expect(adopted).toBeLessThan(0.65);
    for (const a of block) if (a.assignGroup === pw) expect(a.knownExits & (1 << pw)).toBeTruthy();
    const all = sim.agents.filter((a) => !a.wheelchair);
    const share = all.filter((a) => a.assignGroup >= 0).length / all.length;
    expect(Math.abs(share - 0.6 * 0.7)).toBeLessThan(0.06);
  });

  it('Models A and B assign exactly the same people (shared random stream)', () => {
    const a = new SimulationEngine(geo, cfg, 8).agents.map((x) => x.assignGroup);
    const b = new NetworkSimulation(geo, cfg, 8).agents.map((x) => x.assignGroup);
    expect(a).toEqual(b);
  });

  it('switched off, nobody is pre-assigned and the audience is unchanged', () => {
    const sim = new SimulationEngine(geo, scenarioById('concert-emergency'), 3);
    expect(sim.agents.every((a) => a.assignGroup === -1)).toBe(true);
    const p1 = createPopulation(geo, cfg, 3).agents.map((a) => [a.v0, a.tResponse]);
    const p2 = createPopulation(geo, scenarioById('concert-emergency'), 3).agents.map((a) => [a.v0, a.tResponse]);
    expect(p1).toEqual(p2);
  });
});

describe('Crowd Managers: posts and queue rebalancing', () => {
  it('an explicit post list selects the staffed posts in order', () => {
    const cfg = mergeConfig(scenarioById('concert-emergency'), { crowdManagers: { count: 3, posts: ['CM7', 'CM10', 'CM1'] } });
    const sim = new SimulationEngine(geo, cfg, 1);
    expect(sim.guidance.cms.map((c) => c.post.id)).toEqual(['CM7', 'CM10', 'CM1']);
  });

  it('rebalancing redirects zones when the planned exit has a long queue (A and B)', () => {
    const cfg = mergeConfig(scenarioById('concert-emergency'), { crowdManagers: { rebalance: { enabled: true, interval: 5, threshold: 10 } } });
    const sim = new SimulationEngine(geo, cfg, 2);
    sim.run();
    expect(sim.guidance.redirections).toBeGreaterThan(0);
    const b = runNetworkSimulation(geo, cfg, 2);
    expect(b.sim.redirections).toBeGreaterThan(0);
    expect(b.result.allLeftBuilding).toBe(true);
  });

  it('the staff estimate grows with the queue on the route', () => {
    const sim = new SimulationEngine(geo, scenarioById('concert-emergency'), 1);
    const cm = sim.guidance.cms[0];
    const before = sim.guidance.staffEstimate(cm.node, 0);
    expect(Number.isFinite(before)).toBe(true);
    // put an artificial queue on every gate
    sim.gates.queueNow.fill(50);
    expect(sim.guidance.staffEstimate(cm.node, 0)).toBeGreaterThan(before + 10);
  });
});

describe('alarm: declaration delay and voice message', () => {
  it('the declaration delay is added to recognition; a voice message scales recognition and response', () => {
    const tone = createPopulation(geo, defaultConfig(), 4).agents;
    const late = createPopulation(geo, mergeConfig(defaultConfig(), { alarm: { declarationDelay: 10 } }), 4).agents;
    const voice = createPopulation(geo, mergeConfig(defaultConfig(), { alarm: { mode: 'voice', voiceRecognitionFactor: 0.5, voiceResponseFactor: 0.8 } }), 4).agents;
    tone.forEach((a, i) => {
      expect(late[i].tRecognition).toBeCloseTo(a.tRecognition + 10, 9);
      expect(voice[i].tRecognition).toBeCloseTo(a.tRecognition * 0.5, 9);
      expect(voice[i].tResponse).toBeCloseTo(a.tResponse * 0.8, 9);
    });
  });
});

describe('groups agree to meet outside', () => {
  it('members leave as soon as they are individually ready (earlier starts)', () => {
    const base = scenarioById('concert-emergency');
    const meet = mergeConfig(base, { population: { groupMeetOutside: true } });
    let d = 0;
    for (const s of [5, 6]) d += runSimulation(geo, meet, s).meanStart - runSimulation(geo, base, s).meanStart;
    expect(d).toBeLessThan(0);
  }, 60000);
});

describe('responders entering against the flow', () => {
  it('reduce the capacity of the listed gates from the given time only', () => {
    const cfg: SimConfig = mergeConfig(defaultConfig(), { stress: { responders: { links: ['F1'], fromTime: 60, capacityFactor: 0.5 } } });
    const sim = new SimulationEngine(geo, cfg, 1);
    const g = sim.gates as GateSystem;
    const f1 = sim.graph.linkByIdOrThrow('F1');
    const f2 = sim.graph.linkByIdOrThrow('F2');
    g.refill(0.1, 10);
    const early = g.cap[f1];
    g.refill(0.1, 61);
    expect(g.cap[f1]).toBeCloseTo(early * 0.5, 9);
    expect(g.cap[f2]).toBeCloseTo(g.baseCap[f2] * g.urgencyFactor(0), 9);
  });
});

describe('Model B: counterflow shares capacity', () => {
  it('runs with separated groups walking back still complete and never exceed capacity', () => {
    const cfg = scenarioById('reunite');
    const r = runNetworkSimulation(geo, cfg, 3);
    expect(r.result.allLeftBuilding).toBe(true);
    for (const gs of r.result.gates) expect(gs.maxPassesPerSecond).toBeLessThanOrEqual(Math.ceil(gs.capacity) + 1);
  });
});

describe('Model C: individual bound and pre-movement budget', () => {
  const cfg = scenarioById('concert-emergency');
  const net = networkFor(geo, cfg);
  const pre = benchmarkPeople(geo, cfg, 1, 'pre');

  it('the individual bound exceeds every departure time and covers wheelchair users', () => {
    const b = individualBound(net, cfg, pre);
    const maxDep = Math.max(...pre.map((p) => p.tDepart));
    expect(b.tInd).toBeGreaterThan(maxDep);
    const wc = pre.map((p, i) => (p.wheelchair ? b.times[i] : NaN)).filter(Number.isFinite);
    expect(wc.length).toBe(3);
    // slower people never get a smaller bound than an otherwise identical faster person
    const p0 = { ...pre[10], tDepart: 0 };
    const slow = individualBound(net, cfg, [{ ...p0, v0: 0.6 }]).tInd;
    const fast = individualBound(net, cfg, [{ ...p0, v0: 1.4 }]).tInd;
    expect(slow).toBeGreaterThan(fast);
  });

  it('wheelchair users are not part of the flow benchmark', () => {
    const rel = releasesFromPopulation(net, cfg, pre);
    expect(rel.length).toBe(pre.length - 3);
    const te = timeExpandedFlow(net, cfg, rel, { dt: 1 });
    expect(te.N).toBe(pre.length - 3);
  });

  it('the pre-movement budget is monotone in the target time', () => {
    const a180 = premovementBudget(net, cfg, pre, 180).alpha;
    const a150 = premovementBudget(net, cfg, pre, 150).alpha;
    expect(a150).toBeLessThanOrEqual(a180 + 1e-9);
    expect(a180).toBeGreaterThan(0);
  }, 120000);
});

describe('tail metrics', () => {
  it('are consistent with the evacuation time and the time series', () => {
    const r = runSimulation(geo, scenarioById('concert-emergency'), 9);
    expect(r.insideAt180).toBe(r.series.inside[180]);
    const maxLevel = Math.max(...Object.values(r.clearanceByLevel));
    expect(maxLevel).toBeCloseTo(r.tEvac, 0);
    expect(r.lastOut.n).toBe(20);
    expect(Object.values(r.lastOut.zones).reduce((a, b) => a + b, 0)).toBe(20);
    expect(r.p90Exit).toBeLessThanOrEqual(r.p95Exit);
    expect(r.p95Exit).toBeLessThanOrEqual(r.p99Exit);
    expect(r.p99Exit).toBeLessThanOrEqual(r.tEvac);
    const blocks = Object.keys(r.meanExitByBlock);
    expect(blocks.length).toBe(planBlocks(geo).length);
  });
});

describe('route consistency: persistent taste and no re-entry', () => {
  it('every person has one persistent taste per exit, identical in Models A and B', () => {
    const cfg = scenarioById('concert-emergency');
    const a = new SimulationEngine(geo, cfg, 12).agents;
    const b = new NetworkSimulation(geo, cfg, 12).agents;
    expect(a[0].taste.length).toBe(EXIT_GROUPS.length);
    expect(a.map((x) => Array.from(x.taste))).toEqual(b.map((x) => Array.from(x.taste)));
  });

  it('nobody walks back into the hall, the corridor or the orchestra (D doors, FC doors, access stairs)', () => {
    const sim = new SimulationEngine(geo, scenarioById('concert-emergency'), 6);
    const g = sim.graph;
    const inward: string[] = [];
    sim.traceHook = (e) => {
      const L = g.links[e.to];
      if (!/^(D\d|FC\d|OST_[A-Z]+)$/.test(L.id)) return;
      const F = g.links[e.from];
      const shared = F.a === L.a || F.b === L.a ? L.a : L.b;
      if (shared === L.b && !sim.agents[e.agent].separated) inward.push(`${e.agent}:${L.id}`);
    };
    const r = sim.run();
    expect(r.allLeftBuilding).toBe(true);
    expect(inward).toEqual([]);
  });
});
