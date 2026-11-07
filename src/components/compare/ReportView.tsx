/**
 * Renders a ComparisonReport (from the in-browser runner or from `npm run compare`):
 * baseline A/B/C statistics and paired decomposition, interventions, occupancy and sensitivity.
 * Everything shown is computed from actual simulation runs / optimisation results in the report.
 */
import { useRef, useState } from 'react';
import type { CellResult, ComparisonReport } from '../../compare/Experiments';
import { EXIT_GROUPS } from '../../geometry/types';
import type { Summary } from '../../simulation/MonteCarlo';
import { BoxPlot, Histogram, LineChart, Tornado } from '../Charts';
import { GROUP_SHORT, download, fmt, seriesColor, toCsv } from '../util';

const ci = (s?: Summary, d = 0) => (s && s.n ? `${fmt(s.mean, d)} [${fmt(s.ciLow, d)}, ${fmt(s.ciHigh, d)}]` : 'n/a');
const pm = (p?: { p: number; lo: number; hi: number }) => (p ? `${(p.p * 100).toFixed(0)}% [${(p.lo * 100).toFixed(0)}-${(p.hi * 100).toFixed(0)}]` : 'n/a');
const sig = (s?: Summary) => !!s && s.n > 1 && (s.ciLow > 0 || s.ciHigh < 0);
const COL = { A: seriesColor(0), B: seriesColor(1), C: seriesColor(2), Cp: seriesColor(3) };

export function BaselineSection({ c, title }: { c: CellResult; title?: string }) {
  const A = c.stats.A;
  const B = c.stats.B;
  const C = c.stats.C;
  const curves = [
    ...(c.meanCurveA ? [{ name: 'A detailed agent-based (mean)', color: COL.A, values: c.meanCurveA }] : []),
    ...(c.meanCurveB ? [{ name: 'B network behavioural (mean)', color: COL.B, values: c.meanCurveB }] : []),
    ...(c.phys.curveImm ? [{ name: 'C ideal, ready at t = 0', color: COL.C, values: c.phys.curveImm, dashed: true }] : []),
    ...(c.phys.curvePre ? [{ name: 'C ideal, sampled pre-movement (seed 1)', color: COL.Cp, values: c.phys.curvePre, dashed: true }] : []),
  ];
  return (
    <div className="card">
      <h3>{title ?? c.name}</h3>
      <table className="data">
        <thead>
          <tr>
            <th>Metric</th>
            <th>A detailed</th>
            <th>B network</th>
            <th>C ideal flow</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Evacuation time, mean [95% CI] (s)</td>
            <td>{ci(A?.tEvac, 1)}</td>
            <td>{ci(B?.tEvac, 1)}</td>
            <td>
              T* {fmt(C?.imm.mean, 0)} (ready at 0) · {ci(C?.pre)} (sampled pre-movement)
            </td>
          </tr>
          <tr>
            <td>Median · SD · 95th percentile across runs (s)</td>
            <td>{A ? `${fmt(A.tEvac.median)} · ${fmt(A.tEvac.sd)} · ${fmt(A.tEvac.p95)}` : 'n/a'}</td>
            <td>{B ? `${fmt(B.tEvac.median)} · ${fmt(B.tEvac.sd)} · ${fmt(B.tEvac.p95)}` : 'n/a'}</td>
            <td>{C ? `pre: ${fmt(C.pre.median)} · ${fmt(C.pre.sd)} · ${fmt(C.pre.p95)}` : 'n/a'}</td>
          </tr>
          <tr>
            <td>P(T ≤ 180 s) [Wilson 95%]</td>
            <td>{pm(A?.pMeet)}</td>
            <td>{pm(B?.pMeet)}</td>
            <td>
              {pm(C?.pMeetImm)} (t=0) · {pm(C?.pMeetPre)} (pre)
            </td>
          </tr>
          <tr>
            <td>p95 individual exit time (s)</td>
            <td>{ci(A?.p95Exit)}</td>
            <td>{ci(B?.p95Exit)}</td>
            <td>-</td>
          </tr>
          <tr>
            <td>Mean queue time per person (s)</td>
            <td>{ci(A?.meanQueueTime, 1)}</td>
            <td>{ci(B?.meanQueueTime, 1)}</td>
            <td>-</td>
          </tr>
          <tr>
            <td>Largest queue (mean persons) · most frequent place</td>
            <td>{A ? `${fmt(A.maxQueue.mean, 0)} · ${A.topBottleneck}` : 'n/a'}</td>
            <td>{B ? `${fmt(B.maxQueue.mean, 0)} · ${B.topBottleneck}` : 'n/a'}</td>
            <td>min cut: {c.phys.cut.map((x) => x.label).join(', ')}</td>
          </tr>
          <tr>
            <td>Runs with unresolved agents</td>
            <td>{A ? `${(A.fracUnresolved * 100).toFixed(0)}%` : 'n/a'}</td>
            <td>{B ? `${(B.fracUnresolved * 100).toFixed(0)}%` : 'n/a'}</td>
            <td>-</td>
          </tr>
          {EXIT_GROUPS.map((g) => (
            <tr key={g}>
              <td>Exit usage {GROUP_SHORT[g]} (mean persons)</td>
              <td>{A ? fmt(A.meanUsage[g], 0) : 'n/a'}</td>
              <td>{B ? fmt(B.meanUsage[g], 0) : 'n/a'}</td>
              <td>{fmt(c.phys.exitUsageImm[g] ?? 0, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Paired decomposition (same seeds)</h3>
      <table className="data">
        <tbody>
          {c.stats.diffs.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td className={sig(d) ? 'sig' : ''}>{ci(d, 1)} s</td>
              <td className="muted small">n = {d.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Static max flow F* = {fmt(c.phys.maxFlow, 2)} p/s vs. {fmt(c.phys.requiredRate, 2)} p/s required on average for 180 s (N/F* = {fmt(c.phys.flowTime, 0)} s is a rate statement, not an evacuation
        time). B − A is not a purely behavioural effect (spatial representation, collisions, queue implementation, time step, speed model also differ).
      </p>
      <div className="grid2">
        <div>
          <h3>Cumulative evacuated</h3>
          <LineChart series={curves} xLabel="time (s)" yLabel="persons outside" refX={180} />
        </div>
        <div>
          <h3>Completion-time distributions</h3>
          <BoxPlot
            items={[
              ...(c.tEvacA?.length ? [{ label: 'A detailed', values: c.tEvacA.filter(Number.isFinite), color: COL.A }] : []),
              ...(c.tEvacB?.length ? [{ label: 'B network', values: c.tEvacB.filter(Number.isFinite), color: COL.B }] : []),
            ]}
            xLabel="evacuation time (s)"
            refX={180}
          />
          {c.tEvacA?.length ? <Histogram values={c.tEvacA.filter(Number.isFinite)} xLabel="A: evacuation time (s)" refX={180} color={COL.A} bins={16} /> : null}
          {c.tEvacB?.length ? <Histogram values={c.tEvacB.filter(Number.isFinite)} xLabel="B: evacuation time (s)" refX={180} color={COL.B} bins={16} /> : null}
        </div>
      </div>
    </div>
  );
}

export function InterventionsSection({ cells }: { cells: CellResult[] }) {
  const ref = cells[0];
  return (
    <div className="card">
      <h3>Interventions (paired seeds; effects relative to "{ref?.name}")</h3>
      <table className="data">
        <thead>
          <tr>
            <th>Configuration</th>
            <th>A: T (s)</th>
            <th>B: T (s)</th>
            <th>A: ΔT</th>
            <th>B: ΔT</th>
            <th>A: Δp95 exit</th>
            <th>B: Δp95 exit</th>
            <th>A / B worst run (s)</th>
            <th>P(T≤180) A / B</th>
            <th>C: F* (p/s) · T*</th>
            <th>Bottleneck A / B</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c, i) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{ci(c.stats.A?.tEvac)}</td>
              <td>{ci(c.stats.B?.tEvac)}</td>
              <td className={sig(c.effectA) ? 'sig' : ''}>{i ? ci(c.effectA, 1) : 'ref.'}</td>
              <td className={sig(c.effectB) ? 'sig' : ''}>{i ? ci(c.effectB, 1) : 'ref.'}</td>
              <td className={sig(c.effectP95A) ? 'sig' : ''}>{i ? ci(c.effectP95A, 1) : 'ref.'}</td>
              <td className={sig(c.effectP95B) ? 'sig' : ''}>{i ? ci(c.effectP95B, 1) : 'ref.'}</td>
              <td>
                {fmt(c.stats.A?.tEvac.max, 0)} / {fmt(c.stats.B?.tEvac.max, 0)}
              </td>
              <td>
                {pm(c.stats.A?.pMeet)} / {pm(c.stats.B?.pMeet)}
              </td>
              <td>
                {fmt(c.phys.maxFlow, 2)} · {fmt(c.phys.tStarImm, 0)} s
              </td>
              <td className="small">
                {c.stats.A?.topBottleneck ?? '-'} / {c.stats.B?.topBottleneck ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Bold = paired 95% CI excludes 0. A strategy is only "better" when its interval is clearly below zero; single runs prove nothing.</p>
      <div className="grid2">
        <div>
          <h3>Model A: completion times</h3>
          <BoxPlot items={cells.filter((c) => c.tEvacA?.length).map((c, i) => ({ label: c.id, values: c.tEvacA!.filter(Number.isFinite), color: seriesColor(i) }))} xLabel="evacuation time (s)" refX={180} />
        </div>
        <div>
          <h3>Model B: completion times</h3>
          <BoxPlot items={cells.filter((c) => c.tEvacB?.length).map((c, i) => ({ label: c.id, values: c.tEvacB!.filter(Number.isFinite), color: seriesColor(i) }))} xLabel="evacuation time (s)" refX={180} />
        </div>
      </div>
      <h3>Exit distribution (mean persons) A · B · C</h3>
      <table className="data">
        <thead>
          <tr>
            <th>Configuration</th>
            {EXIT_GROUPS.map((g) => (
              <th key={g}>{GROUP_SHORT[g]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              {EXIT_GROUPS.map((g) => (
                <td key={g} className="small">
                  {fmt(c.stats.A?.meanUsage[g], 0)} · {fmt(c.stats.B?.meanUsage[g], 0)} · {fmt(c.phys.exitUsageImm[g] ?? 0, 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** simple x-y chart with CI whiskers (x = occupancy) */
function XYChart({ x, series, xLabel, yLabel, refY }: { x: number[]; series: { name: string; color: string; y: number[]; lo?: number[]; hi?: number[]; dashed?: boolean }[]; xLabel: string; yLabel: string; refY?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const W = 560;
  const H = 240;
  const M = { l: 52, r: 14, t: 10, b: 36 };
  const ys = series.flatMap((s) => [...s.y, ...(s.hi ?? [])]).filter(Number.isFinite);
  const ymin = Math.min(0, ...ys);
  const ymax = Math.max(1, refY ?? 0, ...ys) * 1.05;
  const X = (v: number) => M.l + ((v - Math.min(...x)) / Math.max(1e-9, Math.max(...x) - Math.min(...x))) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - ((v - ymin) / (ymax - ymin)) * (H - M.t - M.b);
  const ticks = Array.from({ length: 6 }, (_, k) => ymin + ((ymax - ymin) * k) / 5);
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} className="grid" />
            <text x={M.l - 6} y={Y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {refY !== undefined && <line x1={M.l} x2={W - M.r} y1={Y(refY)} y2={Y(refY)} className="ref" />}
        {x.map((v, i) => (
          <g key={v}>
            <text x={X(v)} y={H - M.b + 16} className="tick" textAnchor="middle">
              {Math.round(v * 100)}%
            </text>
            <rect x={X(v) - 20} y={M.t} width={40} height={H - M.t - M.b} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <path d={s.y.map((v, i) => (Number.isFinite(v) ? `${i ? 'L' : 'M'}${X(x[i])},${Y(v)}` : '')).join('')} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />
            {s.y.map((v, i) =>
              Number.isFinite(v) ? (
                <g key={i}>
                  {s.lo && s.hi && Number.isFinite(s.lo[i]) && <line x1={X(x[i])} x2={X(x[i])} y1={Y(s.lo[i])} y2={Y(s.hi[i])} stroke={s.color} strokeWidth={1.5} />}
                  <circle cx={X(x[i])} cy={Y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                </g>
              ) : null,
            )}
          </g>
        ))}
        <text x={(M.l + W) / 2} y={H - 4} className="axis-label" textAnchor="middle">
          {xLabel}
        </text>
        <text x={12} y={H / 2} className="axis-label" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
          {yLabel}
        </text>
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <span className="swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div className="chart-tip" style={{ left: X(x[hover]) * ((wrap.current?.clientWidth ?? W) / W) + 10, top: 10 }}>
          <b>{Math.round(x[hover] * 100)}% occupancy</b>
          {series.map((s) => (
            <div key={s.name}>
              {s.name}: {fmt(s.y[hover], 1)}
              {s.lo ? ` [${fmt(s.lo[hover], 1)}, ${fmt(s.hi![hover], 1)}]` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OccupancySection({ cells }: { cells: (CellResult & { occ: number })[] }) {
  const x = cells.map((c) => c.occ);
  const d = cells.map((c) => c.stats.diffs.find((q) => q.label.startsWith('B - A')));
  return (
    <div className="card">
      <h3>Evacuation time versus occupancy (legal Crowd Manager minimum)</h3>
      <div className="grid2">
        <XYChart
          x={x}
          xLabel="occupancy"
          yLabel="evacuation time (s)"
          refY={180}
          series={[
            { name: 'A detailed', color: COL.A, y: cells.map((c) => c.stats.A?.tEvac.mean ?? NaN), lo: cells.map((c) => c.stats.A?.tEvac.ciLow ?? NaN), hi: cells.map((c) => c.stats.A?.tEvac.ciHigh ?? NaN) },
            { name: 'B network', color: COL.B, y: cells.map((c) => c.stats.B?.tEvac.mean ?? NaN), lo: cells.map((c) => c.stats.B?.tEvac.ciLow ?? NaN), hi: cells.map((c) => c.stats.B?.tEvac.ciHigh ?? NaN) },
            { name: 'C ideal, ready at 0', color: COL.C, y: cells.map((c) => c.phys.tStarImm), dashed: true },
            { name: 'C ideal, sampled pre-movement', color: COL.Cp, y: cells.map((c) => c.stats.C?.pre.mean ?? NaN), dashed: true },
          ]}
        />
        <XYChart x={x} xLabel="occupancy" yLabel="B − A (s), paired" series={[{ name: 'B − A, mean [95% CI]', color: seriesColor(6), y: d.map((q) => q?.mean ?? NaN), lo: d.map((q) => q?.ciLow ?? NaN), hi: d.map((q) => q?.ciHigh ?? NaN) }]} />
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>Occupancy</th>
            <th>A: T (s)</th>
            <th>B: T (s)</th>
            <th>C: T* t=0 / pre</th>
            <th>P(T≤180) A / B</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={c.id}>
              <td>{Math.round(c.occ * 100)}%</td>
              <td>{ci(c.stats.A?.tEvac)}</td>
              <td>{ci(c.stats.B?.tEvac)}</td>
              <td>
                {fmt(c.phys.tStarImm, 0)} / {fmt(c.stats.C?.pre.mean, 0)}
              </td>
              <td>
                {pm(c.stats.A?.pMeet)} / {pm(c.stats.B?.pMeet)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SensitivitySection({ sens }: { sens: NonNullable<ComparisonReport['sensitivity']> }) {
  const base = sens.find((s) => s.key === 'base')?.levels[0];
  const rows = sens.filter((s) => s.key !== 'base');
  const tor = (m: 'A' | 'B') =>
    rows
      .filter((s) => s.levels.every((l) => (m === 'A' ? l.effectA : l.effectB)?.n))
      .map((s) => {
        const b = (m === 'A' ? base?.stats.A?.tEvac.mean : base?.stats.B?.tEvac.mean) ?? NaN;
        const e = (l: (typeof s.levels)[number]) => b + ((m === 'A' ? l.effectA?.mean : l.effectB?.mean) ?? NaN);
        return { label: s.label, low: e(s.levels[0]), high: e(s.levels[1]), lowLabel: s.levels[0].level, highLabel: s.levels[1].level };
      });
  const tA = tor('A');
  const tB = tor('B');
  return (
    <div className="card">
      <h3>Sensitivity (one factor at a time, paired with the baseline)</h3>
      <div className="grid2">
        <div>
          <h4>Model A</h4>
          {tA.length ? <Tornado items={tA} base={base?.stats.A?.tEvac.mean ?? NaN} /> : <div className="muted">no Model A runs</div>}
        </div>
        <div>
          <h4>Model B</h4>
          {tB.length ? <Tornado items={tB} base={base?.stats.B?.tEvac.mean ?? NaN} /> : <div className="muted">no Model B runs</div>}
        </div>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>Factor</th>
            <th>Level</th>
            <th>A: ΔT (s)</th>
            <th>B: ΔT (s)</th>
            <th>C: F* (p/s)</th>
            <th>C: T*_imm (s)</th>
          </tr>
        </thead>
        <tbody>
          {sens.flatMap((s) =>
            s.levels.map((l) => (
              <tr key={l.id}>
                <td>{s.label}</td>
                <td>{l.level}</td>
                <td className={sig(l.effectA) ? 'sig' : ''}>{s.key === 'base' ? `T = ${ci(l.stats.A?.tEvac)}` : ci(l.effectA, 1)}</td>
                <td className={sig(l.effectB) ? 'sig' : ''}>{s.key === 'base' ? `T = ${ci(l.stats.B?.tEvac)}` : ci(l.effectB, 1)}</td>
                <td>{fmt(l.phys.maxFlow, 2)}</td>
                <td>{fmt(l.phys.tStarImm, 0)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <p className="muted small">Door/stair widths are estimated from the scanned plans (about ±0.3 m); the width rows give the uncertainty band this implies for each model.</p>
    </div>
  );
}

export function ReportView({ report }: { report: ComparisonReport }) {
  return (
    <div className="report">
      <div className="row">
        <span className="muted small">
          Report generated {new Date(report.generated).toLocaleString()} ({report.source}), {report.runsPerCell} paired seeds per cell
          {report.sectionRuns ? ` (${Object.entries(report.sectionRuns).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}, base seed {report.baseSeed}, models {report.models.join(' + ')}
        </span>
        <button className="btn small" onClick={() => download('comparison-report.json', JSON.stringify(report, null, 1), 'application/json')}>
          Export report (JSON)
        </button>
        <button className="btn small" onClick={() => download('comparison-summary.csv', toCsv(reportRows(report)), 'text/csv')}>
          Export summary (CSV)
        </button>
      </div>
      {report.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
      {report.baseline && <BaselineSection c={report.baseline} title={`Baseline: ${report.baseline.name}`} />}
      {report.interventions && <InterventionsSection cells={report.interventions} />}
      {report.occupancy && <OccupancySection cells={report.occupancy} />}
      {report.sensitivity && <SensitivitySection sens={report.sensitivity} />}
    </div>
  );
}

export function reportRows(r: ComparisonReport): Record<string, unknown>[] {
  const cells: (CellResult & { section: string; level?: string })[] = [
    ...(r.baseline ? [{ ...r.baseline, section: 'baseline' }] : []),
    ...(r.interventions ?? []).map((c) => ({ ...c, section: 'interventions' })),
    ...(r.occupancy ?? []).map((c) => ({ ...c, section: 'occupancy' })),
    ...(r.sensitivity ?? []).flatMap((s) => s.levels.map((c) => ({ ...c, section: `sensitivity:${s.key}` }))),
  ];
  return cells.map((c) => ({
    section: c.section,
    id: c.id,
    name: c.name,
    A_mean: c.stats.A?.tEvac.mean,
    A_ciLow: c.stats.A?.tEvac.ciLow,
    A_ciHigh: c.stats.A?.tEvac.ciHigh,
    A_p95: c.stats.A?.tEvac.p95,
    A_pMeet180: c.stats.A?.pMeet.p,
    A_meanQueue: c.stats.A?.meanQueueTime.mean,
    B_mean: c.stats.B?.tEvac.mean,
    B_ciLow: c.stats.B?.tEvac.ciLow,
    B_ciHigh: c.stats.B?.tEvac.ciHigh,
    B_p95: c.stats.B?.tEvac.p95,
    B_pMeet180: c.stats.B?.pMeet.p,
    B_meanQueue: c.stats.B?.meanQueueTime.mean,
    C_imm: c.phys.tStarImm,
    C_pre_mean: c.stats.C?.pre.mean,
    F_star: c.phys.maxFlow,
    effectA: c.effectA?.mean,
    effectB: c.effectB?.mean,
  }));
}
