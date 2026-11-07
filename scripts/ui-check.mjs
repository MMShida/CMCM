// Automated UI smoke check with the locally installed Chrome (puppeteer-core).
// Usage: node scripts/ui-check.mjs [outDir]   (dev server must run on :5173)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--window-size=1600,1000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const base = 'http://localhost:5173/';
const shots = [
  ['live-t60-split', '?tab=live&scenario=concert-emergency&autostart=1&until=60&floor=split&theme=light', 1500],
  ['live-t120-heat', '?tab=live&scenario=concert-emergency&autostart=1&until=120&floor=floor1&heat=current&theme=light&select=120', 1500],
  ['live-overlay-plan', '?tab=live&scenario=concert-emergency&autostart=1&until=45&floor=split&overlay=0.55&theme=light', 1500],
  ['live-overlay-chart', '?tab=live&scenario=concert-emergency&floor=floor1&overlay=0.6&overlayKind=chart&theme=light', 2500],
  ['live-blocked-barriers', '?tab=live&scenario=led-barriers&autostart=1&until=80&floor=floor1&theme=light', 1500],
  ['live-finished', '?tab=live&scenario=concert-emergency&autostart=1&until=2000&floor=split&theme=light', 2500],
  ['live-led', '?tab=live&scenario=led&autostart=1&until=70&floor=split&theme=light', 1500],
  ['live-dark-overlay', '?tab=live&scenario=concert-emergency&autostart=1&until=90&floor=split&overlay=0.4&heat=current&theme=dark&select=300', 1500],
  ['model', '?tab=model&theme=light', 800],
  ['geometry-editor', '?tab=geo&theme=light', 1500],
];
for (const [name, q, wait] of shots) {
  await page.goto(base + q, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: name === 'model' });
  if (name === 'live-finished') {
    // the result panel is below the map inside the scrolling <main>
    await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop = m.scrollHeight; });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${out}/live-finished-results.png` });
  }
  console.log('shot', name);
}
// Monte Carlo in Web Workers (real time)
await page.goto(base + '?tab=mc&scenario=concert-emergency&mcrun=16&theme=light', { waitUntil: 'networkidle2' });
const t0 = Date.now();
await page.waitForFunction(() => document.body.innerText.includes('Completion-time histogram'), { timeout: 240000 });
console.log('monte carlo 16 runs in browser workers:', ((Date.now() - t0) / 1000).toFixed(1), 's');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${out}/monte-carlo.png`, fullPage: true });
// strategy comparison (small)
await page.goto(base + '?tab=exp&exprun=12&strats=S0,S1,S2,S3&theme=light', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.body.innerText.includes('Paired differences vs reference') && !!document.getElementById('exp-start'), { timeout: 600000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${out}/compare-strategies.png` });
await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 900; });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${out}/compare-strategies-charts.png` });
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
