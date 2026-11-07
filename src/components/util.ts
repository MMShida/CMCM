import type { ExitGroupId } from '../geometry/types';

export function download(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toFixed(4)) : '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

export const fmt = (x: number | undefined, d = 1) => (x !== undefined && Number.isFinite(x) ? x.toFixed(d) : 'n/a');
export const pct = (x: number, d = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');

/** Reference categorical palette (fixed order, never cycled). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function seriesColor(i: number): string {
  const dark = typeof window !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  const pal = dark ? SERIES_DARK : SERIES;
  return pal[i % pal.length];
}

export const GROUP_COLOR_INDEX: Record<ExitGroupId, number> = {
  FOYER: 0,
  PORTICO_W: 1,
  PORTICO_E: 2,
  STAGE_W: 3,
  STAGE_E: 4,
  BAL_NW: 5,
  BAL_NE: 6,
};

export const GROUP_SHORT: Record<ExitGroupId, string> = {
  FOYER: 'Foyer',
  PORTICO_W: 'Portico W',
  PORTICO_E: 'Portico E',
  STAGE_W: 'Stage W',
  STAGE_E: 'Stage E',
  BAL_NW: 'Balcony NW',
  BAL_NE: 'Balcony NE',
};

/** single-hue orange ramp (sequential magnitude) for density */
export function densityColor(d: number, alpha = 0.75): string {
  const t = Math.max(0, Math.min(1, d / 4));
  // light -> dark orange
  const r = Math.round(253 - t * (253 - 166));
  const g = Math.round(208 - t * (208 - 54));
  const b = Math.round(162 - t * (162 - 3));
  return `rgba(${r},${g},${b},${(0.25 + 0.75 * t) * alpha})`;
}
