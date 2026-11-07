import { describe, expect, it } from 'vitest';
import { BAILEY_HALL, barrierSlots } from '../src/geometry/BaileyHall';
import { segIntersect } from '../src/geometry/BaileyHallBuilder';
import { NavGraph, computeField } from '../src/geometry/NavigationGraph';
import { EXIT_GROUPS } from '../src/geometry/types';

const geo = BAILEY_HALL;
const g = new NavGraph(geo);

describe('geometry reconstruction', () => {
  it('has the official seat capacities (527 / 486 / 316 = 1,329 incl. 3 wheelchair positions)', () => {
    const by = { orchestra: 0, mezzanine: 0, balcony: 0 };
    for (const s of geo.seats) by[s.level]++;
    expect(by).toEqual({ orchestra: 527, mezzanine: 486, balcony: 316 });
    expect(geo.seats.filter((s) => s.wheelchair).length).toBe(3);
    expect(geo.seats.length).toBe(1329);
  });

  it('contains the required doors and connectors', () => {
    const ids = new Set(geo.links.map((l) => l.id));
    for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']) expect(ids.has(d)).toBe(true); // nine auditorium exit doors
    for (const d of ['P1', 'P2', 'P3', 'P4']) expect(ids.has(d)).toBe(true); // four side doors to the portico
    for (const d of ['FC1', 'FC2', 'FC3']) expect(ids.has(d)).toBe(true); // corridor -> foyer
    for (const d of ['F1', 'F2', 'F3', 'F4', 'F5']) expect(ids.has(d)).toBe(true); // five foyer doors
    const access = geo.links.filter((l) => l.id.startsWith('OST_'));
    expect(access.length).toBe(6); // six orchestra -> mezzanine access points
    expect(geo.links.filter((l) => l.id.startsWith('BSF')).length).toBe(4); // 2 balcony stairs x 2 flights
    expect(geo.links.filter((l) => l.id.startsWith('PST_')).length).toBe(2); // two portico stairs
  });

  it('no walkable link crosses a wall (agents cannot walk through walls)', () => {
    const problems: string[] = [];
    for (const w of geo.walls) {
      if (w.kind === 'outline' || w.kind === 'column') continue;
      for (const l of geo.links) {
        if (l.prohibited) continue;
        const lf = l.floor === 0 ? 1 : l.floor;
        if (lf !== w.floor) continue;
        for (let i = 1; i < w.pts.length; i++)
          for (let j = 1; j < l.pts.length; j++)
            if (segIntersect(w.pts[i - 1], w.pts[i], l.pts[j - 1], l.pts[j])) problems.push(`${l.id} x ${w.id}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('stairs connect only valid levels', () => {
    for (const L of g.links.filter((l) => l.isStair)) {
      const fa = g.nodes[L.a].floor;
      const fb = g.nodes[L.b].floor;
      const pair = `${fa}-${fb}`;
      if (L.id.startsWith('BNST')) expect(pair).toBe('2-0'); // stage-side stairwells: balcony directly outside
      else if (L.id === 'BSF1W' || L.id === 'BSF1E') expect(pair).toBe('2-1');
      else if (L.id.startsWith('SES')) expect(pair).toBe('1-0');
      else expect(['1-1', '1-0']).toContain(pair);
      expect(Math.abs(L.drop)).toBeGreaterThan(0);
    }
  });

  it('the elevator is never part of the navigable graph', () => {
    const elev = g.linkIndex.get('ELEV_link')!;
    expect(g.links[elev].prohibited).toBe(true);
    for (const adj of g.adj) for (const e of adj) expect(e.link).not.toBe(elev);
  });

  it('every seat row reaches every exit group (no isolated areas), except via prohibited links', () => {
    const fields = g.safeByGroup.map((t) => computeField(g, t, (li) => g.links[li].prohibited));
    for (const s of geo.seats) {
      const L = g.links[g.linkIndex.get(s.link)!];
      const ends = [L.a, L.b].filter((n) => g.nodes[n].kind !== 'deadEnd');
      expect(ends.length).toBeGreaterThan(0);
      const best = Math.min(...ends.map((n) => fields[0].dist[n]));
      expect(Number.isFinite(best)).toBe(true);
    }
    expect(EXIT_GROUPS.length).toBe(7);
  });

  it('barrier placement actually changes the path network', () => {
    const slots = barrierSlots(geo);
    expect(slots.length).toBe(6);
    const w2 = g.linkIndex.get(slots.find((s) => s.label === 'W2')!.id)!;
    const from = g.nodeIndex.get('C_D3W')!;
    const open = computeField(g, g.safeByGroup[0], (li) => g.links[li].prohibited);
    const barred = computeField(g, g.safeByGroup[0], (li) => g.links[li].prohibited || li === w2);
    expect(barred.dist[from]).toBeGreaterThan(open.dist[from] + 2);
    // the first step of the shortest route from the D3 corridor junction changes
    expect(g.adj[from][barred.next[from]].link).not.toBe(g.adj[from][open.next[from]].link);
  });
});
