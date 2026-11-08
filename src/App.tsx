import { useEffect, useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { ExperimentComparison } from './components/ExperimentComparison';
import { GeometryEditor } from './components/GeometryEditor';
import { LiveView } from './components/LiveView';
import { ModelDocs } from './components/ModelDocs';
import { ResearchStudyView } from './components/ResearchStudyView';
import { MonteCarloPanel, type StudyReplay } from './components/MonteCarloPanel';
import { SensitivityPanel } from './components/SensitivityPanel';
import { CompareView } from './components/compare/CompareView';
import { ModelExperiments } from './components/compare/ModelExperiments';
import { ResultsDashboard } from './components/compare/ResultsDashboard';
import { NetworkView } from './components/network/NetworkView';
import { DensityView } from './components/dynamics/DensityView';
import { ManagersView } from './components/dynamics/ManagersView';
import { BAILEY_HALL } from './geometry/BaileyHall';
import type { GeometryData } from './geometry/types';
import type { SimConfig } from './simulation/Params';
import { cloneConfig, defaultConfig, mergeConfig } from './simulation/Params';
import { scenarioById } from './simulation/Scenarios';

type Tab = 'lite' | 'live' | 'mc' | 'density' | 'cms' | 'exp' | 'sens' | 'net' | 'cmp' | 'cmpx' | 'dash' | 'geo' | 'model' | 'research';
const TABS: [Tab, string][] = [
  ['live', 'Live simulation (A)'],
  ['lite', 'A-Lite simulation'],
  ['research', '180-second study'],
  ['mc', 'Monte Carlo'],
  ['density', 'Density over time'],
  ['cms', 'Crowd Managers'],
  ['exp', 'Compare strategies'],
  ['sens', 'Sensitivity'],
  ['net', 'Network model (B/C)'],
  ['cmp', 'Compare models'],
  ['cmpx', 'Model experiments'],
  ['dash', 'Results dashboard'],
  ['geo', 'Geometry editor'],
  ['model', 'Model & parameters'],
];

function lsGet<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable: ignore */
  }
}

const URLP = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (URLP.get('tab') as Tab) ?? lsGet('bailey.tab', 'live'));
  const [scenarioId, setScenarioId] = useState<string>(() => URLP.get('scenario') ?? lsGet('bailey.scenario', 'concert-emergency'));
  const [cfg, setCfg] = useState<SimConfig>(() => {
    const sc = URLP.get('scenario');
    if (sc) {
      const c = scenarioById(sc);
      if (URLP.get('seed')) c.seed = Number(URLP.get('seed'));
      return c;
    }
    const stored = lsGet<SimConfig | null>('bailey.config', null);
    // merge onto current defaults so configs saved by older versions stay valid
    return stored ? mergeConfig(defaultConfig(), stored as any) : scenarioById('concert-emergency');
  });
  const [replay, setReplay] = useState<StudyReplay|null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const [geo, setGeo] = useState<GeometryData>(BAILEY_HALL);
  const [dark, setDark] = useState<boolean>(() => (URLP.get('theme') ? URLP.get('theme') === 'dark' : lsGet('bailey.dark', typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches)));

  useEffect(() => lsSet('bailey.tab', tab), [tab]);
  useEffect(() => lsSet('bailey.scenario', scenarioId), [scenarioId]);
  useEffect(() => lsSet('bailey.config', cfg), [cfg]);
  useEffect(() => {
    lsSet('bailey.dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const update = (fn: (c: SimConfig) => void) =>
    setCfg((c) => {
      const n = cloneConfig(c);
      fn(n);
      return n;
    });
  const onScenario = (id: string) => {
    setReplay(null);setReplayKey(k=>k+1);
    const c = scenarioById(id, geo);
    c.seed = cfg.seed;
    setScenarioId(id);
    setCfg(c);
  };
  const bundled = geo === BAILEY_HALL;
  const showControls = tab !== 'geo' && tab !== 'model' && tab !== 'dash' && tab !== 'research';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <b>Bail(ey)ing Out</b> <span className="muted">evacuation models A (agent-based) · B (network) · C (optimal flow) · Bailey Hall · CMCM 2026 · 04:20 research checkout</span>
        </div>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="btn small" onClick={() => setDark(!dark)} title="toggle dark mode">
          {dark ? '☀' : '☾'}
        </button>
      </header>
      {!bundled && <div className="stale">Using an edited geometry (Geometry editor). Results are not comparable with the bundled reconstruction.</div>}
      <div className={`body ${showControls ? '' : 'full'}`}>
        {showControls && <ControlPanel cfg={cfg} geo={geo} scenarioId={scenarioId} onScenario={onScenario} update={update} replace={(c) => setCfg(c)} />}
        <main>
          {tab === 'live' && <LiveView geo={geo} cfg={cfg} dark={dark} />}
          {tab === 'lite' && <LiveView key="lite" geo={geo} cfg={cfg} dark={dark} model="Lite" />}
          {tab === 'mc' && <MonteCarloPanel key={replayKey} geo={geo} cfg={cfg} bundled={bundled} replay={replay} clearReplay={()=>{setReplay(null);setReplayKey(k=>k+1);}} />}
          {tab === 'density' && <DensityView geo={geo} cfg={cfg} dark={dark} bundled={bundled} />}
          {tab === 'cms' && <ManagersView geo={geo} cfg={cfg} dark={dark} bundled={bundled} />}
          {tab === 'exp' && <ExperimentComparison geo={geo} cfg={cfg} bundled={bundled} />}
          {tab === 'sens' && <SensitivityPanel geo={geo} cfg={cfg} bundled={bundled} />}
          {tab === 'net' && <NetworkView geo={geo} cfg={cfg} dark={dark} />}
          {tab === 'cmp' && <CompareView geo={geo} cfg={cfg} dark={dark} scenarioId={scenarioId} onScenario={onScenario} update={update} />}
          {tab === 'cmpx' && <ModelExperiments geo={geo} cfg={cfg} />}
          {tab === 'dash' && <ResultsDashboard />}
          {tab === 'geo' && <GeometryEditor geo={geo} setGeo={setGeo} dark={dark} />}
          {tab === 'model' && <ModelDocs />}
          {tab === 'research' && <ResearchStudyView apply={(c,model)=>{setReplay(null);setReplayKey(k=>k+1);setGeo(BAILEY_HALL);setCfg(cloneConfig(c));setScenarioId(c.scenarioId);setTab(model==='A'?'live':model==='Lite'?'lite':'net');}} replay={r=>{setGeo(BAILEY_HALL);setCfg(cloneConfig(r.cfg));setReplay(r);setReplayKey(k=>k+1);setTab('mc');}} />}
        </main>
      </div>
    </div>
  );
}
