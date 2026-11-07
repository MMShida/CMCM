// Automated UI check of the network model, model comparison, experiments and dashboard tabs.
// Usage: node scripts/ui-check-compare.mjs [outDir]   (dev server must run on :5173)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--window-size=1600,1000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
const base = 'http://localhost:5173/';
const scroll = async (y) => {
  await page.evaluate((yy) => {
    const m = document.querySelector('main');
    if (m) m.scrollTop = yy;
  }, y);
  await new Promise((r) => setTimeout(r, 500));
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Model B live + Model C panel
await page.goto(base + '?tab=net&scenario=concert-emergency&autostart=1&until=60&theme=light', { waitUntil: 'networkidle2' });
await wait(1500);
await page.screenshot({ path: `${out}/network-live-t60.png` });
console.log('shot network-live-t60');
await page.waitForFunction(() => document.body.innerText.includes('Earliest-arrival curve') && !document.body.innerText.includes('computing'), { timeout: 120000 });
await scroll(900);
await page.screenshot({ path: `${out}/network-flow-mincut.png` });
await scroll(1500);
await page.screenshot({ path: `${out}/network-flow-curves.png` });
console.log('shot network-flow');

// side by side at t = 90 s
await page.goto(base + '?tab=cmp&scenario=concert-emergency&cmpuntil=90&theme=light', { waitUntil: 'networkidle2' });
await wait(2500);
await page.screenshot({ path: `${out}/compare-models-t90.png` });
console.log('shot compare-models-t90');
// run both to the end with the shared clock
await page.goto(base + '?tab=cmp&scenario=concert-emergency&cmpuntil=2000&theme=light', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.body.innerText.includes("C ideal flow, B's departure times"), { timeout: 240000 });
await wait(1000);
await scroll(700);
await page.screenshot({ path: `${out}/compare-models-curves.png` });
console.log('shot compare-models-curves');

// paired Monte Carlo in workers (small)
await page.goto(base + '?tab=cmpx&cmpxrun=4&cmpxwhat=current&cmpxmodels=AB&theme=light', { waitUntil: 'networkidle2' });
const t0 = Date.now();
await page.waitForFunction(() => document.body.innerText.includes('Paired decomposition'), { timeout: 600000 });
console.log('paired A/B/C experiment, 4 seeds, in browser workers:', ((Date.now() - t0) / 1000).toFixed(1), 's');
await wait(800);
await page.screenshot({ path: `${out}/model-experiments.png` });
await scroll(800);
await page.screenshot({ path: `${out}/model-experiments-charts.png` });

// dashboard (CLI report if present)
await page.goto(base + '?tab=dash&theme=light', { waitUntil: 'networkidle2' });
await wait(1500);
await page.screenshot({ path: `${out}/results-dashboard.png` });
await scroll(1100);
await page.screenshot({ path: `${out}/results-dashboard-2.png` });
await scroll(2400);
await page.screenshot({ path: `${out}/results-dashboard-3.png` });
console.log('shot results-dashboard');
// dark mode sanity check
await page.goto(base + '?tab=cmp&scenario=led-barriers&cmpuntil=60&cmpnet=1&theme=dark', { waitUntil: 'networkidle2' });
await wait(2000);
await page.screenshot({ path: `${out}/compare-models-dark.png` });
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
