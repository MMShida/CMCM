/**
 * Tests for dynamic behaviour, adaptive Crowd Managers and density over time (docs/ADAPTIVE.md).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { NetworkSimulation, runNetworkSimulation } from '../src/network/NetworkSimulation';
import { ST } from '../src/simulation/Agent';
import { buildRegions } from '../src/simulation/DensityRegions';
import { FluidQueue, balanceRedirects, buildLoad } from '../src/simulation/PartialRedirect';
import type { CrowdManagerRT } from '../src/simulation/Guidance';
import type { PolicyEnv } from '../src/simulation/ManagerPolicy';
import { ManagerPolicy, newManager } from '../src/simulation/ManagerPolicy';
import { defaultConfig } from '../src/simulation/Params';
import type { SimConfig } from '../src/simulation/Params';
import { PLACEMENT_LABEL, placementPosts } from '../src/simulation/Placements';
import { OUTWARD_ONLY } from '../src/simulation/Routing';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine, runSimulation } from '../src/simulation/SimulationEngine';

const geo = BAILEY_HALL;
const adaptive = (id = 'concert-emergency', agents = true, managers = true, extra: (c: SimConfig) => void = () => {}) => {
  const c = scenarioById(id);
  c.adaptive.agents = agents;
  c.adaptive.managers = managers;
  extra(c);
  return c;
};
const runTo = (sim: { t: number; finished: boolean; step(): void }, T: number) => {
  while (sim.t < T && !sim.finished) sim.step();
};

describe('legacy behaviour is preserved', () => {
  it('adaptive switches off reproduce the stored pre-change results exactly (Model A and B)', () => {
    const ref = JSON.parse(readFileSync('results/legacy-reference.json', 'utf8'));
    const a = runSimulation(geo, scenarioById('concert-emergency'), 11);
    expect([a.tEvac, a.meanExit, a.totalReroutes]).toEqual(ref['concert-emergency|A|11']);
    const b = runNetworkSimulation(geo, scenarioById('concert-emergency'), 11).result;
    expect([b.tEvac, b.meanExit, b.totalReroutes]).toEqual(ref['concert-emergency|B|11']);
  });
});

describe('dynamic individual behaviour', () => {
  it('information changes after observation: beliefs are learned with a time stamp and confidence', () => {
    const sim = new SimulationEngine(geo, adaptive('concert-emergency', true, false), 3);
    runTo(sim, 70);
    const informed = sim.agents.filter((a) => a.beliefT.some((t) => Number.isFinite(t)));
    expect(informed.length).toBeGreaterThan(100);
    const seen = sim.agents.filter((a) => a.confidence.some((c) => c === 1));
    expect(seen.length).toBeGreaterThan(50);
    // beliefs carry the time they were observed, never a future time
    for (const a of informed) for (const t of a.beliefT) if (Number.isFinite(t)) expect(t).toBeLessThanOrEqual(sim.t + 1e-9);
  });

  it('route preferences update when congestion information makes the chosen exit worse', () => {
    const sim = new SimulationEngine(geo, adaptive('concert-emergency', true, false), 4);
    runTo(sim, 50);
    let switched = 0;
    let tried = 0;
    let inSight = 0;
    for (const a of sim.agents) {
      if (tried >= 60) break;
      if (a.state < ST.MOVING || a.state > ST.REUNITING || a.link < 0 || a.targetGroup < 0 || a.group >= 0) continue;
      if (sim.graph.links[a.link].isRow || a.utilities.filter((u) => Number.isFinite(u)).length < 2) continue;
      // alternatives must be reachable from where the person stands now
      a.lastSwitchT = -Infinity;
      sim.routing.chooseExit(a, 'guidance');
      if (a.utilities.filter((u) => Number.isFinite(u)).length < 2) continue;
      tried++;
      const g = a.targetGroup;
      a.belief[g] = 900; // told that its exit has a 15-minute queue
      a.beliefT[g] = sim.t;
      a.lastSwitchT = -Infinity;
      sim.routing.chooseExit(a, 'guidance');
      // a person who can see the exit door trusts the observation over hearsay
      if (a.confidence[g] === 1 && a.targetGroup === g) {
        inSight++;
        continue;
      }
      if (a.targetGroup !== g) switched++;
    }
    expect(tried).toBeGreaterThan(20);
    expect(switched / Math.max(1, tried - inSight)).toBeGreaterThan(0.9);
  });

  it('the commitment interval blocks a routine switch but not a new instruction', () => {
    const sim = new SimulationEngine(geo, adaptive('concert-emergency', true, false), 4);
    runTo(sim, 50);
    const a = sim.agents.find((x) => x.state >= ST.MOVING && x.state <= ST.REUNITING && x.link >= 0 && !sim.graph.links[x.link].isRow && x.group < 0 && x.utilities.filter((u) => Number.isFinite(u)).length >= 2)!;
    const g = a.targetGroup;
    a.belief[g] = 900;
    a.beliefT[g] = sim.t;
    a.lastSwitchT = sim.t; // just switched
    a.urgency = 0;
    sim.routing.chooseExit(a, 'node');
    expect(a.targetGroup).toBe(g);
    sim.routing.chooseExit(a, 'guidance');
    // a new instruction may change it (the belief now strongly favours another exit)
    expect(a.lastDecisionT).toBe(sim.t);
  });

  it('no unrealistic continuous switching (A and B)', () => {
    for (const r of [runSimulation(geo, adaptive(), 5), runNetworkSimulation(geo, adaptive(), 5).result]) {
      const b = r.behaviour!;
      expect(b.maxSwitches).toBeLessThanOrEqual(6);
      expect(b.flipFlops / r.N).toBeLessThan(0.02);
      expect(b.exitSwitches / r.N).toBeLessThan(0.25);
    }
  });

  it('rerouting after a blocked exit: nobody passes the closed door and people learn of it', () => {
    const cfg = adaptive('blocked-discovery');
    const sim = new SimulationEngine(geo, cfg, 6);
    const closed = new Set(sim.blockedLinks);
    let crossed = 0;
    sim.traceHook = (e) => {
      if (closed.has(e.to)) crossed++;
    };
    const r = sim.run();
    expect(crossed).toBe(0);
    expect(r.exitDoorUsage.FC2 ?? 0).toBe(0);
    expect(sim.agents.filter((a) => a.knownBlocked.length > 0).length).toBeGreaterThan(20);
    expect(r.allLeftBuilding).toBe(true);
  });

  it('no invalid routes: closed links are never entered and outward-only doors are never used inwards', () => {
    const sim = new SimulationEngine(geo, adaptive(), 7);
    const outward = sim.graph.links.map((L) => OUTWARD_ONLY.test(L.id));
    let inward = 0;
    sim.traceHook = (e) => {
      const a = sim.agents[e.agent];
      if (outward[e.to] && a.dir < 0 && a.meetNode < 0) inward++;
    };
    const r = sim.run();
    expect(inward).toBe(0);
    for (const a of sim.agents) if (!a.inside && a.exitLink >= 0) expect(sim.graph.links[a.exitLink].exterior).toBe(true);
    expect(r.unresolved.trapped).toBe(0);
  });

  it('same seed gives identical adaptive runs (A and B)', () => {
    const c = adaptive();
    const a1 = runSimulation(geo, c, 8);
    const a2 = runSimulation(geo, c, 8);
    expect(a1.tEvac).toBe(a2.tEvac);
    expect(a1.behaviour).toEqual(a2.behaviour);
    expect(a1.density!.peak).toEqual(a2.density!.peak);
    const b1 = runNetworkSimulation(geo, c, 8).result;
    const b2 = runNetworkSimulation(geo, c, 8).result;
    expect(b1.tEvac).toBe(b2.tEvac);
    expect(b1.managers!.map((m) => m.history.length)).toEqual(b2.managers!.map((m) => m.history.length));
  });

  it('adaptation does not automatically improve results: a paired case where adaptive managers are worse', () => {
    const legacy = runNetworkSimulation(geo, scenarioById('concert-emergency'), 12).result;
    const adapt = runNetworkSimulation(geo, adaptive('concert-emergency', false, true), 12).result;
    expect(adapt.tEvac).toBeGreaterThan(legacy.tEvac);
  });
});

describe('adaptive Crowd Manager policy (unit)', () => {
  const mkEnv = (q: number[], closed: Set<number> = new Set()): PolicyEnv => ({
    queueAt: (g) => q[g],
    capOf: () => 1,
    closedGate: (g) => closed.has(g),
    route: (_n, gi, knows) => (knows && closed.has(gi) ? null : { walk: 10 + gi, gates: [gi] }),
    groupCap: [5, 5, 5, 5, 5, 5, 5],
  });
  const post = (id: string, x: number) => ({ id, x, y: 0, floor: 1 as const, label: id, zones: ['Z'] });

  it('switches when the watched route becomes congested, holds the instruction, then returns', () => {
    const cfg = defaultConfig();
    cfg.adaptive.managers = true;
    const q = [100, 0, 0, 0, 0, 0, 0];
    const m = newManager(0, post('M', 0), 0, 0, [0], false);
    m.obsGates = [0, 1];
    const pol = new ManagerPolicy(cfg, [m], mkEnv(q), 1, 'test');
    for (let t = 0; t <= 6; t++) pol.step(t);
    expect(m.redirect.get(0)).toBe(1);
    expect(m.history.length).toBe(1);
    // a critical bottleneck (> 30 s) is acted on as soon as it is observed (t = 2, after the 2 s delay)
    expect(m.history[0].t).toBe(2);
    q[0] = 0; // queue clears
    for (let t = 7; t <= 21; t++) pol.step(t);
    expect(m.redirect.get(0)).toBe(1); // minimum hold 20 s
    for (let t = 22; t <= 40; t++) pol.step(t);
    expect(m.redirect.has(0)).toBe(false); // back to the plan
    expect(m.history[1].t).toBeGreaterThanOrEqual(22);
  });

  it('a fixed plan retains acoustic observation but redirects for a known closure', () => {
    const cfg = defaultConfig();cfg.adaptive.managers = true;cfg.adaptive.staticPlan = true;
    const closed = new Set<number>();const m = newManager(0, post('M',0),0,0,[0],false);m.obsGates=[0,1];
    const pol = new ManagerPolicy(cfg,[m],mkEnv([100,0,0,0,0,0,0],closed),1,'static-test');
    for(let t=0;t<=10;t++)pol.step(t);
    expect(m.redirect.size).toBe(0);closed.add(0);
    for(let t=11;t<=16;t++)pol.step(t);
    expect(m.knowsBlocked).toBe(true);expect(m.redirect.get(0)).not.toBeUndefined();
  });

  it('managers only know what they observe: an unwatched queue changes nothing', () => {
    const cfg = defaultConfig();
    cfg.adaptive.managers = true;
    const m = newManager(0, post('M', 0), 0, 0, [0], false);
    m.obsGates = [1]; // does not watch gate 0
    const pol = new ManagerPolicy(cfg, [m], mkEnv([500, 0, 0, 0, 0, 0, 0]), 1, 'test');
    for (let t = 0; t <= 30; t++) pol.step(t);
    expect(m.redirect.size).toBe(0);
  });

  it('a non-lead manager adopts the lead decision by radio (no contradictory instructions)', () => {
    const cfg = defaultConfig();
    cfg.adaptive.managers = true;
    cfg.adaptive.commReliability = 1;
    const lead = newManager(0, post('L', 0), 0, 0, [0], false);
    const other = newManager(1, post('O', 5), 0, 0, [0], false);
    lead.obsGates = [0];
    lead.peers = [1]; // voice areas overlap
    other.peers = [0];
    const far = newManager(2, post('F', 50), 0, 0, [0], false); // no peers: decides for its own area
    const pol = new ManagerPolicy(cfg, [lead, other, far], mkEnv([100, 0, 0, 0, 0, 0, 0]), 1, 'test');
    for (let t = 0; t <= 15; t++) pol.step(t);
    expect(lead.redirect.get(0)).toBe(1);
    expect(other.redirect.get(0)).toBe(1);
    expect(other.history[0].reason).toMatch(/lead/);
    // the far manager received the radio observation (gate 0 congested) and decided itself
    expect(far.history.every((h) => !/lead/.test(h.reason))).toBe(true);
    expect(far.known.has(0)).toBe(true);
  });

  it('no double counting: people already sent to the instructed exit are not added to its load again', () => {
    const cfg = defaultConfig();
    cfg.adaptive.managers = true;
    const pc = cfg.crowdManagers.complianceProb;
    const m = newManager(0, post('M', 0), 0, 0, [0], false);
    m.plannedCount = new Map([[0, 50]]);
    m.redirect.set(0, 1); // planned exit 0 currently sent to exit 1
    const pol = new ManagerPolicy(cfg, [m], mkEnv([0, 0, 0, 0, 0, 0, 0]), 1, 'test');
    const est = pol.estimates(m, 0, 5);
    expect(est[1]).toBeCloseTo(11, 6); // current destination: observed state only (walk 11, no wait known)
    expect(est[2]).toBeCloseTo(12 + (pc * 50) / 5, 6); // moving them again loads the new destination
    expect(est[0]).toBeCloseTo(10 + (pc * 50) / 5, 6); // returning them to the plan loads the plan
  });

  it('a lead counts the people its following peers would move with the same decision', () => {
    const cfg = defaultConfig();
    cfg.adaptive.managers = true;
    cfg.adaptive.commReliability = 1;
    const pc = cfg.crowdManagers.complianceProb;
    const lead = newManager(0, post('L', 0), 0, 0, [0], false);
    const other = newManager(1, post('O', 5), 0, 0, [0], false);
    lead.peers = [1];
    other.peers = [0];
    other.plannedCount = new Map([[0, 100]]);
    const pol = new ManagerPolicy(cfg, [lead, other], mkEnv([0, 0, 0, 0, 0, 0, 0]), 1, 'test');
    expect(pol.estimates(lead, 0, 10)[1]).toBeCloseTo(11 + (pc * 100) / 5, 6);
    // without coordination the follower does not apply the lead's decision
    cfg.adaptive.coordination = false;
    expect(pol.estimates(lead, 0, 10)[1]).toBeCloseTo(11, 6);
  });

  it('a closure on the instructed exit is acted on at once (no hold)', () => {
    const cfg = defaultConfig();
    cfg.adaptive.managers = true;
    const closed = new Set<number>([0]);
    const m = newManager(0, post('M', 0), 0, 0, [0], false);
    m.obsGates = [0];
    const pol = new ManagerPolicy(cfg, [m], mkEnv([0, 0, 0, 0, 0, 0, 0], closed), 1, 'test');
    for (let t = 0; t <= 3; t++) pol.step(t);
    expect(m.knowsBlocked).toBe(true);
    expect(m.redirect.get(0)).not.toBeUndefined();
  });
});

describe('Crowd Manager scope: responsibility, reach and influence', () => {
  it('reach changes as people move: people enter and leave a manager’s reach', () => {
    const sim = new SimulationEngine(geo, adaptive(), 9);
    const cm = sim.guidance.cms[2] as CrowdManagerRT;
    const R = sim.cfg.crowdManagers.radius;
    const inAt = (T: number) => {
      runTo(sim, T);
      return new Set(sim.agents.filter((a) => !a.done && a.inside && sim.guidance.inReach(cm, a, R)).map((a) => a.id));
    };
    const s1 = inAt(25);
    const s2 = inAt(70);
    const left = [...s1].filter((i) => !s2.has(i)).length;
    const entered = [...s2].filter((i) => !s1.has(i)).length;
    expect(left).toBeGreaterThan(10);
    expect(entered).toBeGreaterThan(10);
    const H = cm.series.H;
    expect(Math.max(...H)).toBeGreaterThan(Math.min(...H.slice(Math.ceil(cm.tActive) + 2)));
  });

  it('walls block the voice: nobody in the corridor or foyer is in reach of a manager inside the auditorium', () => {
    const sim = new SimulationEngine(geo, adaptive(), 9);
    runTo(sim, 90);
    const cm = sim.guidance.cms[2] as CrowdManagerRT; // CM3, mezzanine W radial aisle
    const R = sim.cfg.crowdManagers.radius;
    const outside = sim.agents.filter((a) => a.link >= 0 && /^(FY[LV]_|CFC_|FC\d)/.test(sim.graph.links[a.link].id));
    expect(outside.length).toBeGreaterThan(0);
    for (const a of outside) {
      const walk = sim.guidance.walkDistance(cm, a);
      if (walk > sim.cfg.adaptive.reachFactor * R) expect(sim.guidance.inReach(cm, a, R)).toBe(false);
    }
  });

  it('multiple managers: a contradictory instruction is counted, costs hesitation and the newer one is adopted', () => {
    const sim = new SimulationEngine(geo, adaptive(), 10);
    runTo(sim, 30);
    const [c1, c2] = sim.guidance.cms as CrowdManagerRT[];
    const a = sim.agents.find((x) => !x.done && x.inside && !x.wheelchair)!;
    a.uCM = 0; // always complies
    const g0 = sim.guidance.recommend(a, false, true, sim.cfg.crowdManagers.plan, c1);
    const other = (g0 + 1) % 7;
    c2.redirect.set(g0, other);
    const h0 = a.hesitate;
    (sim.guidance as any).instructAdaptive(a, c1);
    expect(a.cmSource).toBe(c1.idx);
    (sim.guidance as any).instructAdaptive(a, c2);
    expect(a.conflicts).toBe(1);
    expect(c1.conflicts).toBe(1);
    expect(c2.conflicts).toBe(1);
    expect(a.cmSource).toBe(c2.idx);
    expect(a.cmGroup).toBe(other);
    expect(a.hesitate).toBeGreaterThanOrEqual(h0 + sim.cfg.adaptive.conflictDelay - 1e-9);
    expect(a.trust).toBeLessThan(1);
  });

  it('responsibility and influence counts follow their definitions', () => {
    const sim = new SimulationEngine(geo, adaptive(), 11);
    runTo(sim, 1.05);
    for (const cm of sim.guidance.cms) {
      const expected = sim.agents.filter((a) => cm.zones.includes(geo.seats[a.seat].zone) && a.inside && !a.done).length;
      expect(cm.series.R[cm.series.R.length - 1]).toBe(expected);
    }
    runTo(sim, 80.05);
    const I = sim.guidance.cms.map((cm) => cm.series.I[cm.series.I.length - 1]);
    const manual = sim.guidance.cms.map((cm) => sim.agents.filter((a) => !a.done && a.inside && a.cmSource === cm.idx && a.cmGroup >= 0 && a.targetGroup === a.cmGroup).length);
    // I is recorded at the start of the step; routes may change during the rest of that step
    I.forEach((v, i) => expect(Math.abs(v - manual[i])).toBeLessThanOrEqual(3));
    // influence never exceeds the people who adopted that manager's instruction
    for (const cm of sim.guidance.cms) expect(cm.complied).toBeGreaterThanOrEqual(Math.max(...cm.series.I));
  });
});

describe('placements', () => {
  it('every placement has its declared staffing on walkable posts and assigns every zone exactly once', () => {
    const zones = new Set(geo.seats.map((s) => s.zone));
    for (const id of Object.keys(PLACEMENT_LABEL) as (keyof typeof PLACEMENT_LABEL)[]) {
      if (id === 'existing') continue;
      const posts = placementPosts(geo, id)!;
      const count=id==='coverage18'?18:id==='coverage12'?12:id==='coverage10'?10:6;
      expect(posts.length).toBe(count);
      const assigned = posts.flatMap((p) => p.zones);
      expect(new Set(assigned).size).toBe(assigned.length);
      expect(new Set(assigned)).toEqual(zones);
      const cfg = adaptive();
      cfg.crowdManagers.placement = id;
      cfg.crowdManagers.count = count;
      const sim = new SimulationEngine(geo, cfg, 1);
      expect(sim.guidance.cms.length).toBe(count);
      for (const cm of sim.guidance.cms) {
        const n = sim.graph.nodes[cm.node];
        expect(Math.hypot(n.x - cm.post.x, n.y - cm.post.y)).toBeLessThan(3);
      }
    }
  });
});

describe('density over time', () => {
  it('regions never overlap and areas come from the geometry', () => {
    const cfg = defaultConfig();
    const map = buildRegions(geo, cfg);
    const seen = new Set<string>();
    for (const R of map.regions) {
      expect(R.area).toBeGreaterThan(0);
      for (const id of R.links) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      const area = R.links.reduce((s, id) => {
        const L = geo.links.find((x) => x.id === id)!;
        let len = 0;
        for (let i = 1; i < L.pts.length; i++) len += Math.hypot(L.pts[i][0] - L.pts[i - 1][0], L.pts[i][1] - L.pts[i - 1][1]);
        return s + len * L.width;
      }, 0);
      expect(R.area).toBeCloseTo(area, 0);
    }
  });

  it('density = occupancy / area, recorded through time, conserving people (Model A)', () => {
    const cfg = adaptive();
    cfg.analysis.keepSeries = true;
    const sim = new SimulationEngine(geo, cfg, 12);
    // no double counting: occupancy summed over regions equals people on measured links
    runTo(sim, 60);
    const onMeasured = sim.agents.filter((a) => a.link >= 0 && !a.done && sim.regionOfLink[a.link] >= 0).length;
    const r = sim.run();
    const S = r.density!.series!;
    const k60 = S.t.findIndex((t) => Math.abs(t - 60) < 1e-6);
    expect(S.occ.reduce((s, o) => s + o[k60], 0)).toBe(onMeasured);
    expect(S.t.length).toBeGreaterThan(150);
    r.density!.regions.forEach((R, i) => {
      for (let k = 0; k < S.t.length; k += 17) expect(S.dens[i][k]).toBeCloseTo(S.occ[i][k] / R.area, 2);
      // conservation: change of occupancy = inflow - outflow between samples
      for (let k = 1; k < S.t.length; k++) expect(S.occ[i][k] - S.occ[i][k - 1]).toBe(S.inflow[i][k] - S.outflow[i][k]);
    });
    expect(Math.max(...r.density!.peak)).toBeGreaterThan(1);
    expect(r.density!.heat!.frames.length).toBe(S.t.length);
    expect(r.density!.exposure.mean).toBeGreaterThan(0);
  });

  it('Model B reports the same regions and areas, with occupancy over time', () => {
    const cfg = adaptive();
    cfg.analysis.keepSeries = true;
    const a = runSimulation(geo, cfg, 13);
    const b = runNetworkSimulation(geo, cfg, 13).result;
    expect(b.density!.regions).toEqual(a.density!.regions);
    expect(Math.max(...b.density!.series!.occ.map((o) => Math.max(...o)))).toBeGreaterThan(20);
    // same audience in both models
    const sa = new SimulationEngine(geo, cfg, 13);
    const sb = new NetworkSimulation(geo, cfg, 13);
    expect(sa.agents.map((x) => x.seat)).toEqual(sb.agents.map((x) => x.seat));
    expect(sb.cmTimes.map((c) => c.id)).toEqual(sa.guidance.cms.map((c) => c.id));
  });

  it('capacity constraints still hold with adaptive behaviour (gate passes per second)', () => {
    const r = runSimulation(geo, adaptive(), 14);
    for (const G of r.gates) if (G.passes > 0) expect(G.maxPassesPerSecond).toBeLessThanOrEqual(Math.ceil(G.capacity * 1.2) + 1);
  });
});

describe('partial redirection by managers who see everything (Model A only)', () => {
  // 200 people queue for an exit draining 4 p/s (50 s); an empty alternative drains 1 p/s, 15 s further
  const twoExits = () => {
    const qs = [new FluidQueue(4), new FluidQueue(1)];
    for (let i = 0; i < 200; i++) qs[0].add(0, i);
    for (const q of qs) q.build();
    const cands = Array.from({ length: 200 }, (_, i) => ({
      ids: [i],
      start: 0,
      stay: { to: 0, stops: [{ k: 0, walk: 0 }], tail: 0 },
      alt: [{ to: 1, stops: [{ k: 1, walk: 15 }], tail: 0 }],
    }));
    return { qs, cands };
  };

  it('balancing moves the analytical number of people: n* = (Q_a/c_a - dw) / (1/c_a + 1/c_b)', () => {
    const { qs, cands } = twoExits();
    const { moved } = balanceRedirects(qs, cands, 0, () => true);
    // n* = (50 - 15) / (0.25 + 1) = 28: both exits then finish after about 43 s
    expect(moved).toBe(28);
    const lastA = qs[0].dep[qs[0].dep.length - 1];
    const lastB = qs[1].dep[qs[1].dep.length - 1];
    expect(Math.abs(lastA - lastB)).toBeLessThan(1.5);
  });

  it('a person keeps their place in the queue: only the people at the back are moved', () => {
    const { qs, cands } = twoExits();
    const movedIds: number[] = [];
    balanceRedirects(qs, cands, 0, (i) => (movedIds.push(i), true));
    expect(Math.min(...movedIds)).toBeGreaterThanOrEqual(200 - 28);
  });

  it('a person who does not comply is not counted as moved, and more people are asked instead', () => {
    const { qs, cands } = twoExits();
    let k = 0;
    const out = balanceRedirects(qs, cands, 0, () => k++ % 2 === 0);
    expect(out.moved).toBeGreaterThan(18);
    expect(out.moved).toBeLessThanOrEqual(28);
    expect(out.asked).toBeGreaterThanOrEqual(2 * out.moved - 1);
  });

  it('a shared bottleneck is not relieved by sending people to another exit behind it', () => {
    // 160 people pass one hall door (2 p/s, 80 s) to the foyer; the portico is also behind that door
    const stay = { to: 0, stops: [{ k: 0, walk: 0 }, { k: 1, walk: 2 }], tail: 0 };
    const qs = buildLoad([2, 4, 4], Array.from({ length: 160 }, (_, i) => ({ id: i, start: 0, route: stay })), 3);
    // chained arrivals: the foyer door behind the hall door has no queue of its own
    expect(qs[1].dep[159] - qs[1].arr[159]).toBeLessThan(0.3);
    const cands = Array.from({ length: 160 }, (_, i) => ({
      ids: [i],
      start: 0,
      stay: { to: 0, stops: [{ k: 0, walk: 0 }, { k: 1, walk: 2 }], tail: 0 },
      alt: [{ to: 1, stops: [{ k: 0, walk: 0 }, { k: 2, walk: 5 }], tail: 0 }],
    }));
    expect(balanceRedirects(qs, cands, 0, () => true).moved).toBe(0);
  });

  it('in the simulation: people are redirected, nobody twice, every exit is valid, runs are reproducible, default unchanged', () => {
    const c = adaptive('concert-emergency', true, true, (x) => (x.adaptive.redirectMode = 'partial'));
    const sim = new SimulationEngine(geo, c, 21);
    const r = sim.run();
    const G = sim.guidance as unknown as { partialAsked: number; partialMoved: number };
    expect(G.partialAsked).toBeGreaterThan(20);
    expect(G.partialMoved).toBeGreaterThan(5);
    expect(G.partialMoved).toBeLessThanOrEqual(G.partialAsked);
    for (const a of sim.agents) if (!a.inside && a.exitLink >= 0) expect(sim.graph.links[a.exitLink].exterior).toBe(true);
    expect(r.unresolved.trapped).toBe(0);
    const r2 = runSimulation(geo, c, 21);
    expect(r2.tEvac).toBe(r.tEvac);
    // the default (zone) mode never uses the partial mechanism
    const z = new SimulationEngine(geo, adaptive(), 21);
    z.run();
    expect((z.guidance as unknown as { partialAsked: number }).partialAsked).toBe(0);
  });
});
