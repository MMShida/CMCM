import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { NetworkSimulation, PH } from '../src/network/NetworkSimulation';
import { scenarioById } from '../src/simulation/Scenarios';
const sim = new NetworkSimulation(BAILEY_HALL, scenarioById(process.argv[2] ?? 'concert-emergency'), Number(process.argv[3] ?? 1));
sim.run();
const net = sim.net;
for (const n of sim.na) if (n.phase !== PH.OUT) console.log('agent', n.a.id, 'phase', n.phase, 'state', n.a.state, 'node', net.nodes[n.node]?.id, 'arc', n.arc >= 0 ? net.edges[net.arcs[n.arc].edge].id : -1, 'wheel', n.a.wheelchair, 'known', n.a.knownExits.toString(2), 'group', n.exitGroup, 'seat', BAILEY_HALL.seats[n.a.seat].id, 'tStart', n.a.tStartMove, 'path', n.path.map((a) => net.edges[net.arcs[a].edge].id).join(','));
console.log(net.edges.filter((e) => /^2000/.test(e.label)).map((e) => e.id + ' ' + e.label + ' ' + e.kind));
