// UI check of the "Density over time" and "Crowd Managers" tabs (puppeteer-core + local Chrome).
// Usage: node scripts/ui-check-dynamics.mjs [baseUrl] [outDir]   (dev server must be running)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--window-size=1600,1000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
const clickText = async (text) => {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t);
    if (!b) throw new Error('button not found: ' + t);
    b.click();
  }, text);
};
const scrollMain = async (y) => {
  await page.evaluate((v) => {
    const m = document.querySelector('main');
    if (m) m.scrollTop = v;
  }, y);
  await new Promise((r) => setTimeout(r, 400));
};
// adaptive configuration via the stored config is not available from the URL: use the scenario and toggle in the panel
await page.goto(base + '?tab=density&scenario=concert-emergency&seed=11&theme=light', { waitUntil: 'networkidle2' });
// switch on both adaptive options in the control panel
await page.evaluate(() => {
  const sec = [...document.querySelectorAll('details, .section')].find((d) => d.textContent.includes('Dynamic behaviour & adaptive Crowd Managers'));
  if (sec && sec.tagName === 'DETAILS') sec.open = true;
  const sum = [...document.querySelectorAll('summary, .section-title, button')].find((d) => d.textContent.includes('Dynamic behaviour & adaptive Crowd Managers'));
  if (sum) sum.click();
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  for (const lab of document.querySelectorAll('label')) {
    if (/^Dynamic individuals|^Adaptive Crowd Managers/.test(lab.textContent.trim())) {
      const inp = lab.querySelector('input[type=checkbox]');
      if (inp && !inp.checked) inp.click();
    }
  }
});
await new Promise((r) => setTimeout(r, 300));
const t0 = Date.now();
await page.click('#dyn-run');
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/density-live.png` });
await page.waitForFunction(() => document.body.innerText.includes('Regions at t ='), { timeout: 300000 });
console.log('density run recorded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await new Promise((r) => setTimeout(r, 600));
// replay to t = 90 s
await page.evaluate(() => {
  const r = document.querySelector('input[aria-label="replay time"]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(r, '90');
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${out}/density-replay-t90.png` });
await scrollMain(900);
await page.screenshot({ path: `${out}/density-table.png` });
await scrollMain(1700);
await page.screenshot({ path: `${out}/density-timelines.png` });
await scrollMain(2500);
await page.screenshot({ path: `${out}/density-duration-exposure.png` });
// Crowd Managers tab (same recorded run)
await clickText('Crowd Managers');
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${out}/crowd-managers.png` });
await scrollMain(700);
await page.screenshot({ path: `${out}/crowd-managers-charts.png` });
const txt = await page.evaluate(() => document.body.innerText);
console.log(txt.includes('R, H and I over time') ? 'managers tab shows R/H/I' : 'MANAGERS TAB MISSING CONTENT');
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
