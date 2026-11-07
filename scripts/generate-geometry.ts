/**
 * Generates src/data/geometry/bailey-hall.json from the parametric builder.
 * Usage: npm run geometry
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBaileyHall } from '../src/geometry/BaileyHallBuilder';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../src/data/geometry/bailey-hall.json');
const g = buildBaileyHall();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(g));
const byLevel = g.seats.reduce<Record<string, number>>((acc, s) => ((acc[s.level] = (acc[s.level] ?? 0) + 1), acc), {});
console.log(`nodes=${g.nodes.length} links=${g.links.length} seats=${g.seats.length} walls=${g.walls.length}`);
console.log('seats by level', byLevel, 'wheelchair', g.seats.filter((s) => s.wheelchair).length);
for (const n of g.notes) console.log(' -', n);
console.log('written', out);
