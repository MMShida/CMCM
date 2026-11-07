import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { maxFlowBound } from '../src/simulation/QueueModel';
import { scenarioById } from '../src/simulation/Scenarios';
const cfg = scenarioById('concert-emergency');
const show = (name: string, b: ReturnType<typeof maxFlowBound>) => {
  console.log(`${name}: F* = ${b.maxFlow.toFixed(2)} p/s, N/F* = ${b.flowTime.toFixed(1)} s`);
  console.log('   min cut:', b.cut.map((c) => `${c.label} (${c.capacity.toFixed(2)})`).join(', '));
};
for (const sink of ['exterior', 'street'] as const) {
  for (const [name, closed] of [['all open', []], ['FC2 blocked', ['FC2']], ['foyer blocked', ['FC1', 'FC2', 'FC3']]] as [string, string[]][])
    show(`[${sink}] ${name}`, maxFlowBound(BAILEY_HALL, cfg, 1329, closed, { sink }));
}
show('[exterior] orchestra only (527)', maxFlowBound(BAILEY_HALL, cfg, 527, [], { sink: 'exterior', level: 'orchestra' }));
show('[exterior] mezzanine only (486)', maxFlowBound(BAILEY_HALL, cfg, 486, [], { sink: 'exterior', level: 'mezzanine' }));
show('[exterior] balcony only (316)', maxFlowBound(BAILEY_HALL, cfg, 316, [], { sink: 'exterior', level: 'balcony' }));
