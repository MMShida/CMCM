import { useMemo, useState } from 'react';
import { barrierSlots, blockableLinks } from '../geometry/BaileyHall';
import type { ExitGroupId, GeometryData } from '../geometry/types';
import { EXIT_GROUPS, EXIT_GROUP_LABEL } from '../geometry/types';
import type { BehaviorType, SimConfig } from '../simulation/Params';
import { BEHAVIOR_LABEL, BEHAVIOR_TYPES, DEFAULT_PLAN } from '../simulation/Params';
import { SCENARIOS } from '../simulation/Scenarios';
import { NumberField, Section, Select, Slider, Toggle } from './Controls';
import { GROUP_SHORT } from './util';
import { placementPosts } from '../simulation/Placements';

interface Props {
  cfg: SimConfig;
  geo: GeometryData;
  scenarioId: string;
  onScenario: (id: string) => void;
  update: (fn: (c: SimConfig) => void) => void;
  replace: (c: SimConfig) => void;
}

export function ControlPanel({ cfg, geo, scenarioId, onScenario, update, replace }: Props) {
  const scen = SCENARIOS.find((s) => s.id === scenarioId);
  const modifiedPreset=useMemo(()=>{
    if(!scen)return true;
    const original=scen.build(geo);original.seed=cfg.seed;
    return JSON.stringify(original)!==JSON.stringify(cfg);
  },[scen,geo,cfg]);
  const slots = useMemo(() => barrierSlots(geo), [geo]);
  const blockable = useMemo(() => blockableLinks(geo), [geo]);
  const zones = geo.zones;
  const staffPosts=placementPosts(geo,cfg.crowdManagers.placement)??geo.crowdManagerPosts;
  const [json, setJson] = useState<string | null>(null);
  const N = Math.round(cfg.occupancy.orchestra * 527) + Math.round(cfg.occupancy.mezzanine * 486) + Math.round(cfg.occupancy.balcony * 316);
  const shares = cfg.population.typeShares;
  const shareTotal = BEHAVIOR_TYPES.reduce((a, t) => a + shares[t], 0) || 1;
  const pctFmt = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="panel controls">
      <div className="scenario-box">
        <Select
          label="Scenario preset"
          value={scenarioId}
          options={SCENARIOS.map((s) => ({ value: s.id, label: `${s.name}${s.approximate ? ' *' : ''}` }))}
          onChange={onScenario}
        />
        {scen && <p className="desc">{modifiedPreset?'Custom configuration loaded. The controls below show the active settings; selecting a preset replaces them.':scen.description}</p>}
        {scen?.approximate && <p className="warn-note">* Simplified stress test, not a validated physical model.</p>}
        <div className="row">
          <NumberField label="Random seed" value={cfg.seed} onChange={(v) => update((c) => (c.seed = Math.max(0, Math.floor(v))))} tip="Same seed + same configuration = identical simulation" />
          <button className="btn small" onClick={() => update((c) => (c.seed = Math.floor(Math.random() * 1e6)))}>
            New seed
          </button>
        </div>
        <div className="muted small">
          {N} people. Crowd Managers: {cfg.crowdManagers.count < 0 ? `auto (${Math.ceil(N / 250)})` : cfg.crowdManagers.count}
        </div>
      </div>

      <Section title="Occupancy" open>
        <Slider label="Orchestra (527 seats)" value={cfg.occupancy.orchestra} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.occupancy.orchestra = v))} />
        <Slider label="Mezzanine / loge (486)" value={cfg.occupancy.mezzanine} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.occupancy.mezzanine = v))} />
        <Slider label="Balcony (316)" value={cfg.occupancy.balcony} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.occupancy.balcony = v))} />
        <Select
          label="Seat pattern"
          value={cfg.occupancy.pattern}
          options={[
            { value: 'random', label: 'Random seats' },
            { value: 'frontFirst', label: 'Front rows fill first' },
            { value: 'backFirst', label: 'Back rows fill first' },
          ]}
          onChange={(v) => update((c) => (c.occupancy.pattern = v))}
        />
        <Slider label="Wheelchair users" value={cfg.population.wheelchairCount} min={0} max={3} step={1} tip="Up to 3 wheelchair positions (problem statement). Elevator use is prohibited: they wait at an assistance point." onChange={(v) => update((c) => (c.population.wheelchairCount = v))} />
      </Section>

      <Section title="Behaviour types" badge={`${BEHAVIOR_TYPES.length}`}>
        <p className="muted small">Modelling categories (not personality claims). Shares are normalised.</p>
        {BEHAVIOR_TYPES.map((t: BehaviorType) => (
          <Slider key={t} label={BEHAVIOR_LABEL[t]} value={shares[t]} min={0} max={1} step={0.01} format={(v) => `${Math.round((v / shareTotal) * 100)}%`} onChange={(v) => update((c) => (c.population.typeShares[t] = v))} />
        ))}
      </Section>

      <Section title="Reaction time (pre-movement)">
        <Slider label="Recognition median" value={cfg.premovement.recognitionMedian} min={0} max={60} step={0.5} unit="s" tip="Lognormal median time to recognise the cue (ASSUMPTION; shape from Forssberg et al. 2019)" onChange={(v) => update((c) => (c.premovement.recognitionMedian = v))} />
        <Slider label="Recognition sigma" value={cfg.premovement.recognitionSigma} min={0} max={1.5} step={0.05} tip="log-standard deviation" onChange={(v) => update((c) => (c.premovement.recognitionSigma = v))} />
        <Slider label="Response median" value={cfg.premovement.responseMedian} min={0} max={90} step={1} unit="s" tip="Decision time median before standing up (ASSUMPTION)" onChange={(v) => update((c) => (c.premovement.responseMedian = v))} />
        <Slider label="Response sigma" value={cfg.premovement.responseSigma} min={0} max={1.5} step={0.05} onChange={(v) => update((c) => (c.premovement.responseSigma = v))} />
        <Slider label="Aisle-distance effect" value={cfg.premovement.aisleCoef} min={0} max={0.2} step={0.005} unit="/m" tip="log-median increase per metre to the row end (direction: Galea et al. 2017)" onChange={(v) => update((c) => (c.premovement.aisleCoef = v))} />
        <Slider label="Belongings probability" value={cfg.population.belongingsProb} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.population.belongingsProb = v))} />
        <Slider label="Belongings median" value={cfg.population.belongingsMedian} min={0} max={60} step={1} unit="s" onChange={(v) => update((c) => (c.population.belongingsMedian = v))} />
        <Slider label="Extra alarm delay" value={cfg.alarm.recognitionExtra} min={0} max={60} step={1} unit="s" tip="Additional recognition delay (unclear alarm)" onChange={(v) => update((c) => (c.alarm.recognitionExtra = v))} />
        <Slider label="Declaration → alarm delay" value={cfg.alarm.declarationDelay ?? 0} min={0} max={30} step={1} unit="s" tip="The 180 s clock starts when the emergency is declared; nobody can react before the alarm" onChange={(v) => update((c) => (c.alarm.declarationDelay = v))} />
        <Select
          label="Alarm type"
          value={cfg.alarm.mode ?? 'tone'}
          options={[
            { value: 'tone', label: 'Alarm tone' },
            { value: 'voice', label: 'Informative voice message' },
          ]}
          onChange={(v) => update((c) => (c.alarm.mode = v as 'tone' | 'voice'))}
        />
        {cfg.alarm.mode === 'voice' && (
          <>
            <Slider label="Voice: recognition factor" value={cfg.alarm.voiceRecognitionFactor} min={0.2} max={1} step={0.05} tip="ASSUMPTION (direction: Proulx & Sime 1991)" onChange={(v) => update((c) => (c.alarm.voiceRecognitionFactor = v))} />
            <Slider label="Voice: response factor" value={cfg.alarm.voiceResponseFactor} min={0.2} max={1} step={0.05} onChange={(v) => update((c) => (c.alarm.voiceResponseFactor = v))} />
          </>
        )}
        <Slider label="Max wait for group" value={cfg.population.groupWaitMax ?? 90} min={0} max={180} step={5} unit="s" onChange={(v) => update((c) => (c.population.groupWaitMax = v))} />
        <Toggle label="Groups meet outside (announcement)" value={!!cfg.population.groupMeetOutside} onChange={(v) => update((c) => (c.population.groupMeetOutside = v))} />
      </Section>

      <Section title="Walking & physical movement">
        <Slider label="Mean walking speed" value={cfg.population.speedMean} min={0.6} max={1.8} step={0.01} unit="m/s" onChange={(v) => update((c) => (c.population.speedMean = v))} />
        <Slider label="Speed std. dev." value={cfg.population.speedSd} min={0} max={0.5} step={0.01} unit="m/s" onChange={(v) => update((c) => (c.population.speedSd = v))} />
        <Slider label="Share over 65" value={cfg.population.elderlyFraction} min={0} max={1} step={0.05} format={pctFmt} tip="20-25% slower walking (Thompson citing Ando et al. 1988)" onChange={(v) => update((c) => (c.population.elderlyFraction = v))} />
        <Slider label="Seat-row speed" value={cfg.movement.rowSpeed} min={0.2} max={1} step={0.01} unit="m/s" tip="0.45 m/s along seat rows (Predtechenskii & Milinskii)" onChange={(v) => update((c) => (c.movement.rowSpeed = v))} />
        <Slider label="Time headway T" value={cfg.movement.timeHeadway} min={0.3} max={1.5} step={0.05} unit="s" tip="Following model v = (h - d_min)/T" onChange={(v) => update((c) => (c.movement.timeHeadway = v))} />
        <Select
          label="Speed model"
          value={cfg.movement.speedModel}
          options={[
            { value: 'headway', label: 'Time-headway following (default)' },
            { value: 'weidmann', label: 'Weidmann area density' },
          ]}
          onChange={(v) => update((c) => (c.movement.speedModel = v))}
        />
      </Section>

      <Section title="Door & stair capacities">
        <Slider label="Door specific flow" value={cfg.movement.doorFlow} min={0.6} max={2.5} step={0.05} unit="p/s/m" tip="1.3 SFPE design (conservative), 1.9 normal (Seyfried), 3.3-3.7 competitive (Nicolas et al.)" onChange={(v) => update((c) => (c.movement.doorFlow = v))} />
        <Slider label="Stair specific flow" value={cfg.movement.stairFlow} min={0.5} max={2} step={0.05} unit="p/s/m" onChange={(v) => update((c) => (c.movement.stairFlow = v))} />
        <Slider label="Boundary layer (doors)" value={cfg.movement.boundaryLayerDoor} min={0} max={0.3} step={0.01} unit="m" onChange={(v) => update((c) => (c.movement.boundaryLayerDoor = v))} />
        <Slider label="Luggage / coat flow factor" value={cfg.population.luggageFlowFactor} min={0.5} max={1} step={0.01} onChange={(v) => update((c) => (c.population.luggageFlowFactor = v))} />
        <p className="muted small">Individual door widths are edited in the Geometry tab.</p>
      </Section>

      <Section title="Urgency, cooperation, faster-is-slower">
        <Slider label="Urgency u" value={cfg.movement.urgency} min={0} max={1} step={0.05} tip="0 = normal departure, 1 = extreme" onChange={(v) => update((c) => (c.movement.urgency = v))} />
        <Toggle label="Faster-is-slower relation enabled" value={cfg.movement.fasterIsSlower.enabled} onChange={(v) => update((c) => (c.movement.fasterIsSlower.enabled = v))} />
        <Slider label="Moderate-urgency gain" value={cfg.movement.fasterIsSlower.gain} min={0} max={0.5} step={0.01} onChange={(v) => update((c) => (c.movement.fasterIsSlower.gain = v))} />
        <Slider label="Clogging drop" value={cfg.movement.fasterIsSlower.drop} min={0} max={0.9} step={0.01} onChange={(v) => update((c) => (c.movement.fasterIsSlower.drop = v))} />
        <Slider label="Clogging threshold" value={cfg.movement.fasterIsSlower.threshold} min={0} max={0.9} step={0.01} tip="pi = u * mean impatience of the queue above which flow drops" onChange={(v) => update((c) => (c.movement.fasterIsSlower.threshold = v))} />
      </Section>

      <Section title="Social influence & knowledge">
        <Slider label="Social influence kappa" value={cfg.premovement.socialKappa} min={0} max={5} step={0.1} tip="clock rate 1 + kappa * (share of neighbours moving)" onChange={(v) => update((c) => (c.premovement.socialKappa = v))} />
        <Slider label="Social awareness hazard" value={cfg.premovement.socialAwareRate} min={0} max={2} step={0.05} unit="/s" onChange={(v) => update((c) => (c.premovement.socialAwareRate = v))} />
        <Slider label="Knows emergency exits" value={cfg.population.familiarityProb} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.population.familiarityProb = v))} />
        {EXIT_GROUPS.filter((g) => g !== 'FOYER').map((g) => (
          <Slider key={g} label={`Prior knowledge: ${GROUP_SHORT[g]}`} value={cfg.population.exitKnowledge[g]} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.population.exitKnowledge[g] = v))} />
        ))}
        <Slider label="Exit-sign notice probability" value={cfg.routing.noticeProb} min={0} max={1} step={0.01} format={pctFmt} tip="38% perceive conventional signs (Galea et al. 2016)" onChange={(v) => update((c) => (c.routing.noticeProb = v))} />
        <Slider label="Visibility range" value={cfg.routing.visibilityRange} min={3} max={40} step={1} unit="m" onChange={(v) => update((c) => (c.routing.visibilityRange = v))} />
        <Slider label="Social groups" value={cfg.population.groupFraction} min={0} max={0.9} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.population.groupFraction = v))} />
      </Section>

      <Section title="Crowd Managers">
        <Select
          label="Number on duty"
          value={String(cfg.crowdManagers.count)}
          options={[{ value: '-1', label: 'Automatic (1 per 250, inherited rule)' }, ...Array.from({ length: Math.max(staffPosts.length,cfg.crowdManagers.count)+1 }, (_, i) => ({ value: String(i), label: String(i) }))]}
          onChange={(v) => update((c) => (c.crowdManagers.count = Number(v)))}
        />
        <div className="chips">
          {staffPosts.map((p) => (
            <Toggle
              key={p.id}
              label={`${p.id} ${p.label}`}
              value={!cfg.crowdManagers.unavailable.includes(p.id)}
              onChange={(v) =>
                update((c) => {
                  c.crowdManagers.unavailable = v ? c.crowdManagers.unavailable.filter((x) => x !== p.id) : [...c.crowdManagers.unavailable, p.id];
                })
              }
            />
          ))}
        </div>
        <Slider label="Compliance" value={cfg.crowdManagers.complianceProb} min={0} max={1} step={0.01} format={pctFmt} onChange={(v) => update((c) => (c.crowdManagers.complianceProb = v))} />
        <Slider label="Voice radius" value={cfg.crowdManagers.radius} min={3} max={30} step={1} unit="m" onChange={(v) => update((c) => (c.crowdManagers.radius = v))} />
        <Slider label="Activation median" value={cfg.crowdManagers.activationMedian} min={0} max={60} step={1} unit="s" onChange={(v) => update((c) => (c.crowdManagers.activationMedian = v))} />
        <Toggle label="Dynamic: redirect when an exit is blocked" value={cfg.crowdManagers.dynamic} onChange={(v) => update((c) => (c.crowdManagers.dynamic = v))} />
        <Toggle label="Queue rebalancing (redirect when planned exit is much slower)" value={!!cfg.crowdManagers.rebalance?.enabled} onChange={(v) => update((c) => (c.crowdManagers.rebalance = { ...(c.crowdManagers.rebalance ?? { interval: 5, threshold: 20 }), enabled: v }))} />
        {cfg.crowdManagers.rebalance?.enabled && (
          <>
            <Slider label="Rebalance threshold" value={cfg.crowdManagers.rebalance.threshold} min={5} max={60} step={1} unit="s" onChange={(v) => update((c) => (c.crowdManagers.rebalance.threshold = v))} />
            <Slider label="Rebalance interval" value={cfg.crowdManagers.rebalance.interval} min={1} max={30} step={1} unit="s" onChange={(v) => update((c) => (c.crowdManagers.rebalance.interval = v))} />
          </>
        )}
        <p className="muted small">Available posts: {staffPosts.map(p=>p.id).join(', ')}. Active staff are limited to available posts and the selected count.</p>
      </Section>

      <Section title="Dynamic behaviour & adaptive Crowd Managers" badge={cfg.adaptive?.agents || cfg.adaptive?.managers ? 'on' : undefined}>
        <p className="muted small">Both off = the previous fixed-behaviour model (reproduced exactly). See docs/ADAPTIVE.md.</p>
        <Toggle label="Dynamic individuals (beliefs, confidence, urgency, trust, event-triggered rerouting)" value={!!cfg.adaptive?.agents} onChange={(v) => update((c) => (c.adaptive.agents = v))} />
        <Toggle label="Adaptive Crowd Managers (local observation, radio, coordinated instructions, walls block the voice)" value={!!cfg.adaptive?.managers} onChange={(v) => update((c) => (c.adaptive.managers = v))} />
        <Select
          label="Manager placement"
          value={cfg.crowdManagers.placement ?? 'existing'}
          options={[
            { value: 'existing', label: 'A. Existing posts (CM1-CM6)' },
            { value: 'decision', label: 'B. Decision points' },
            { value: 'bottleneck', label: 'C. Bottleneck-oriented' },
            { value: 'hybrid222', label: 'D. Hybrid 2-2-2' },
            { value: 'robust', label: 'E. Robust (one per exit group)' },
            { value: 'coverage', label: 'F. Seat coverage (6 posts)' },
            { value: 'coverage10', label: 'G. Seat coverage (10 posts)' },
            { value: 'coverage12', label: 'H. Extended coverage (12 posts)' },
            { value: 'coverage18', label: 'I. Extended coverage (18 posts)' },
          ]}
          onChange={(v) => update((c) => (c.crowdManagers.placement = v as any))}
        />
        {cfg.adaptive?.agents && (
          <>
            <Select
              label="Congestion information"
              value={cfg.adaptive.congestionInfo}
              options={[
                { value: 'local', label: 'Local: own sight (same room) + memory + managers' },
                { value: 'none', label: 'None: queues not perceived' },
                { value: 'global', label: 'Idealised: every queue visible (benchmark only)' },
              ]}
              onChange={(v) => update((c) => (c.adaptive.congestionInfo = v as any))}
            />
            <Slider label="Memory of congestion information" value={cfg.adaptive.memoryTau} min={10} max={180} step={5} unit="s" onChange={(v) => update((c) => (c.adaptive.memoryTau = v))} />
            <Slider label="Minimum commitment to an exit" value={cfg.adaptive.minCommit} min={0} max={40} step={1} unit="s" onChange={(v) => update((c) => (c.adaptive.minCommit = v))} />
            <Slider label="Re-evaluate when waiting exceeds expected x" value={cfg.adaptive.waitExcessFactor} min={1} max={4} step={0.1} onChange={(v) => update((c) => (c.adaptive.waitExcessFactor = v))} />
            <Slider label="Uncertainty aversion" value={cfg.adaptive.uncertaintyWeight} min={0} max={2} step={0.1} onChange={(v) => update((c) => (c.adaptive.uncertaintyWeight = v))} />
          </>
        )}
        {cfg.adaptive?.managers && (
          <>
            <Select
              label="Communication between managers"
              value={cfg.adaptive.comm}
              options={[
                { value: 'radio', label: 'Radio' },
                { value: 'none', label: 'None (each manager alone)' },
              ]}
              onChange={(v) => update((c) => (c.adaptive.comm = v as any))}
            />
            <Slider label="Radio reliability" value={cfg.adaptive.commReliability} min={0} max={1} step={0.05} format={pctFmt} onChange={(v) => update((c) => (c.adaptive.commReliability = v))} />
            <Slider label="Radio delay" value={cfg.adaptive.commDelay} min={0} max={20} step={1} unit="s" onChange={(v) => update((c) => (c.adaptive.commDelay = v))} />
            <Slider label="Observation range" value={cfg.adaptive.observeRange} min={5} max={40} step={1} unit="m" onChange={(v) => update((c) => (c.adaptive.observeRange = v))} />
            <Slider label="Observation delay" value={cfg.adaptive.observeDelay} min={0} max={15} step={1} unit="s" onChange={(v) => update((c) => (c.adaptive.observeDelay = v))} />
            <Slider label="Minimum instruction hold" value={cfg.adaptive.minHold} min={0} max={60} step={1} unit="s" onChange={(v) => update((c) => (c.adaptive.minHold = v))} />
            <Slider label="Switch threshold" value={cfg.adaptive.switchThreshold} min={5} max={60} step={1} unit="s" onChange={(v) => update((c) => (c.adaptive.switchThreshold = v))} />
            <Select
              label="How managers redirect"
              value={cfg.adaptive.redirectMode ?? 'zone'}
              options={[
                { value: 'zone', label: 'Whole planned exit (local view)' },
                { value: 'partial', label: 'Part of the flow, sized to free capacity (see everything; Model A only)' },
              ]}
              onChange={(v) => update((c) => (c.adaptive.redirectMode = v as any))}
            />
            <Toggle label="Coordinated (one lead manager per planned exit)" value={cfg.adaptive.coordination} onChange={(v) => update((c) => (c.adaptive.coordination = v))} />
            <Toggle label="Managers tell people the congestion they know" value={cfg.adaptive.shareCongestion} onChange={(v) => update((c) => (c.adaptive.shareCongestion = v))} />
            <Toggle label="Formal reassignment when a manager's area is clear" value={cfg.adaptive.reassign === 'whenClear'} onChange={(v) => update((c) => (c.adaptive.reassign = v ? 'whenClear' : 'none'))} />
          </>
        )}
        <Slider label="Reference density for exposure (analysis only)" value={cfg.analysis?.densityRef ?? 2} min={0.5} max={5} step={0.25} unit="p/m²" onChange={(v) => update((c) => (c.analysis.densityRef = v))} />
      </Section>

      <Section title="Pre-assigned exits (pre-show announcement)">
        <Toggle label="Agree on one planned exit per social group" value={!!cfg.crowdManagers.groupPlan} onChange={(v)=>update(c=>{c.crowdManagers.groupPlan=v;})} />
        <Toggle label="Announce each seat block's exit before the show" value={!!cfg.preassign?.enabled} onChange={(v) => update((c) => (c.preassign = { ...c.preassign, enabled: v, plan: { ...c.crowdManagers.plan } }))} />
        {cfg.preassign?.enabled && (
          <>
            <Slider label="Heard and remembered" value={cfg.preassign.reachProb} min={0} max={1} step={0.05} format={pctFmt} tip="ASSUMPTION" onChange={(v) => update((c) => (c.preassign.reachProb = v))} />
            <Slider label="Follow the announced exit" value={cfg.preassign.complianceProb} min={0} max={1} step={0.05} format={pctFmt} tip="ASSUMPTION" onChange={(v) => update((c) => (c.preassign.complianceProb = v))} />
            <button className="btn small" onClick={() => update((c) => (c.preassign.plan = { ...c.crowdManagers.plan }))}>
              Announced plan = CM plan
            </button>
          </>
        )}
      </Section>

      <Section title="Directional LED guidance">
        {cfg.led.spatial&&<p className="muted small">Spatial signs: {cfg.led.spatial.signs.length} fixed messages, {cfg.led.spatial.range} m range, wall occlusion {cfg.led.spatial.occlusion?'on':'off'}. These replace abstract seat-specific LED instructions.</p>}
        <Toggle label="LED strips enabled" value={cfg.led.enabled} onChange={(v) => update((c) => (c.led.enabled = v))} />
        <Slider label="Activation time" value={cfg.led.activationTime} min={0} max={120} step={1} unit="s" onChange={(v) => update((c) => (c.led.activationTime = v))} />
        <Slider label="Perception probability" value={cfg.led.perceiveProb} min={0} max={1} step={0.01} format={pctFmt} tip="Assumed detection probability; not measured in Bailey Hall. Visibility and accepting a message are separate." onChange={(v) => update((c) => (c.led.perceiveProb = v))} />
        <Slider label="Compliance" value={cfg.led.complianceProb} min={0} max={1} step={0.01} format={pctFmt} tip="Assumed acceptance probability. The cited 66% trial outcome was final redirection with coordinated signage and voice, not this probability alone." onChange={(v) => update((c) => (c.led.complianceProb = v))} />
        <Slider label="Conflict hesitation" value={cfg.led.conflictDelay} min={0} max={20} step={1} unit="s" onChange={(v) => update((c) => (c.led.conflictDelay = v))} />
        <Toggle label="Dynamic signage (marks blocked exits)" value={cfg.led.dynamic} onChange={(v) => update((c) => (c.led.dynamic = v))} />
      </Section>

      <Section title="Guidance plans (zone → exit)">
        <p className="muted small">Crowd Manager plan and LED plan. Making them differ simulates contradictory instructions.</p>
        {Object.keys(cfg.crowdManagers.plan).some((k) => k.includes(':')) && (
          <p className="small">
            The CM plan has {Object.keys(cfg.crowdManagers.plan).filter((k) => k.includes(':')).length} seat-block entries (ZONE:SIDE:BAND, e.g. an optimised plan) that override the zone rows below.{' '}
            <button className="btn small" onClick={() => update((c) => (c.crowdManagers.plan = Object.fromEntries(Object.entries(c.crowdManagers.plan).filter(([k]) => !k.includes(':')))))}>
              Remove block entries
            </button>
          </p>
        )}
        <div className="row">
          <button className="btn small" onClick={() => update((c) => (c.led.plan = { ...c.crowdManagers.plan }))}>
            LED = CM plan
          </button>
          <button className="btn small" onClick={() => update((c) => ((c.crowdManagers.plan = { ...DEFAULT_PLAN }), (c.led.plan = { ...DEFAULT_PLAN })))}>
            Reset both
          </button>
        </div>
        <table className="plan">
          <thead>
            <tr>
              <th>Zone</th>
              <th>CM</th>
              <th>LED</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td title={z.label}>{z.id}</td>
                {(['crowdManagers', 'led'] as const).map((k) => (
                  <td key={k}>
                    <select value={cfg[k].plan[z.id] ?? z.defaultExit} onChange={(e) => update((c) => (c[k].plan[z.id] = e.target.value as ExitGroupId))}>
                      {EXIT_GROUPS.map((g) => (
                        <option key={g} value={g} title={EXIT_GROUP_LABEL[g]}>
                          {GROUP_SHORT[g]}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Closed exits" badge={cfg.blocked.links.length ? String(cfg.blocked.links.length) : undefined}>
        <Select
          label="Knowledge of the obstruction"
          value={cfg.blocked.knowledge}
          options={[
            { value: 'discovery', label: 'Discovered on approach only' },
            { value: 'announced', label: 'Crowd Managers announce after delay' },
            { value: 'immediate', label: 'Everyone knows immediately' },
          ]}
          onChange={(v) => update((c) => (c.blocked.knowledge = v))}
        />
        <Slider label="Announcement delay" value={cfg.blocked.announceDelay} min={0} max={180} step={5} unit="s" onChange={(v) => update((c) => (c.blocked.announceDelay = v))} />
        <Slider label="Discovery range" value={cfg.blocked.discoveryRange} min={1} max={20} step={0.5} unit="m" onChange={(v) => update((c) => (c.blocked.discoveryRange = v))} />
        <div className="chips">
          {blockable.map((b) => (
            <Toggle
              key={b.id}
              label={b.label}
              value={cfg.blocked.links.includes(b.id)}
              onChange={(v) => update((c) => (c.blocked.links = v ? [...c.blocked.links, b.id] : c.blocked.links.filter((x) => x !== b.id)))}
            />
          ))}
        </div>
      </Section>

      <Section title="Corridor barriers" badge={cfg.barriers.length ? String(cfg.barriers.length) : undefined}>
        <p className="muted small">Hard panels close a corridor link. Low ropes discourage crossing but remain traversable. W0/E0: between D1/P1 and D2; W1/E1: between P2 and D3; W2/E2: between D3 and D4.</p>
        <div className="chips">
          {slots.map((s) => (
            <Toggle key={s.id} label={`Slot ${s.label}`} value={cfg.barriers.includes(s.id)} onChange={(v) => update((c) => (c.barriers = v ? [...c.barriers, s.id] : c.barriers.filter((x) => x !== s.id)))} />
          ))}
        </div>
        {slots.filter(s=>cfg.barriers.includes(s.id)).map(s=><Select key={s.id} label={`Type at ${s.label}`} value={cfg.barrierTypes?.[s.id]??'hard-panel'} options={[{value:'hard-panel',label:'Hard panel (closed)'},{value:'soft-rope',label:'Low rope (deterrent)'}]} onChange={v=>update(c=>{c.barrierTypes={...c.barrierTypes,[s.id]:v as 'hard-panel'|'soft-rope'};})} />)}
        {cfg.barriers.some(id=>cfg.barrierTypes?.[id]==='soft-rope')&&<Slider label="Rope deterrence (assumed perceived seconds)" value={cfg.ropePenalty??15} min={0} max={60} step={5} unit="s" onChange={v=>update(c=>{c.ropePenalty=v;})} />}
      </Section>

      <Section title="Numerical integration">
        <Toggle label="Preserve fractional service credit (A and B)" value={!!cfg.numerics?.conserveService} onChange={v=>update(c=>{c.numerics={conserveService:v};})} />
        <p className="muted small">Same capacities; retain unused fractions after admissions. Off reproduces the 04:20 integration.</p>
      </Section>

      <Section title="Environment & stress tests">
        <Toggle label="Power failure / darkness (simplified)" value={cfg.environment.darkness} onChange={(v) => update((c) => (c.environment.darkness = v))} />
        <Slider label="Smoke level (simplified)" value={cfg.environment.smoke} min={0} max={1} step={0.05} onChange={(v) => update((c) => (c.environment.smoke = v))} />
        <Slider label="Outdoor stair factor (ice)" value={cfg.environment.outdoorStairFactor} min={0.3} max={1} step={0.05} onChange={(v) => update((c) => (c.environment.outdoorStairFactor = v))} />
        <Toggle label="Falls on stairs (stress test)" value={cfg.stress.falls} onChange={(v) => update((c) => (c.stress.falls = v))} />
        <Slider label="Separated group members" value={cfg.stress.separatedGroups} min={0} max={1} step={0.05} format={pctFmt} tip="share of groups with one member starting in the foyer/corridor (counterflow)" onChange={(v) => update((c) => (c.stress.separatedGroups = v))} />
        <Slider label="Maximum simulated time" value={cfg.tMax} min={120} max={3600} step={60} unit="s" onChange={(v) => update((c) => (c.tMax = v))} />
      </Section>

      <Section title="Advanced: full configuration (JSON)">
        <p className="muted small">Every parameter, including per-type route-choice weights. Edit and apply.</p>
        <textarea className="json" value={json ?? JSON.stringify(cfg, null, 1)} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
        <div className="row">
          <button
            className="btn small"
            onClick={() => {
              try {
                if (json) replace(JSON.parse(json));
                setJson(null);
              } catch (e) {
                alert(`Invalid JSON: ${e}`);
              }
            }}
          >
            Apply JSON
          </button>
          <button className="btn small" onClick={() => setJson(null)}>
            Revert
          </button>
        </div>
      </Section>
    </div>
  );
}
