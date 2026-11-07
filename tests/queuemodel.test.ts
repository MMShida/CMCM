import { describe, expect, it } from 'vitest';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { maxFlowBound } from '../src/simulation/QueueModel';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';

describe('network-flow cross-check', () => {
  const cfg = scenarioById('concert-emergency');
  const bound = maxFlowBound(BAILEY_HALL, cfg, 1329);

  it('has a positive finite maximum flow and a non-empty minimum cut', () => {
    expect(bound.maxFlow).toBeGreaterThan(3);
    expect(bound.maxFlow).toBeLessThan(60);
    expect(bound.cut.length).toBeGreaterThan(0);
  });

  it('the agent model never discharges faster than the max-flow bound (30 s windows)', () => {
    const sim = new SimulationEngine(BAILEY_HALL, cfg, 3);
    sim.run();
    const left = sim.result().series.leftBuilding;
    const W = 30;
    let best = 0;
    for (let t = W; t < left.length; t++) best = Math.max(best, (left[t] - left[t - W]) / W);
    // urgency can raise door flow by at most (1 + gain*u); allow that factor
    const f = 1 + cfg.movement.fasterIsSlower.gain * cfg.movement.urgency;
    expect(best).toBeLessThanOrEqual(bound.maxFlow * f + 1e-9);
    expect(sim.result().tEvac).toBeGreaterThan(bound.flowTime);
  });

  it('closing exits can only reduce the maximum flow', () => {
    const closed = maxFlowBound(BAILEY_HALL, cfg, 1329, ['FC1', 'FC2', 'FC3']);
    expect(closed.maxFlow).toBeLessThan(bound.maxFlow);
  });

  it('nobody climbs a storey-height stair during the evacuation', () => {
    const sim = new SimulationEngine(BAILEY_HALL, cfg, 4);
    let climbs = 0;
    sim.traceHook = (e) => {
      const a = sim.agents[e.agent];
      if (sim.graph.climbs(e.to, a.dir) && a.meetNode < 0) climbs++;
    };
    sim.run();
    expect(climbs).toBe(0);
  });
});
