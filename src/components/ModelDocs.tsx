import { PARAM_INFO } from '../simulation/Params';

export function ModelDocs() {
  return (
    <div className="page docs">
      <h2>Model summary</h2>
      <p>
        Full documentation, equations and limitations: <code>README.md</code>, <code>docs/MODEL.md</code> and <code>docs/PARAMETERS.md</code> in the project folder. Below is the parameter provenance table used by the
        simulator. <b>PROBLEM</b> = given by the CMCM problem; <b>PUBLISHED</b> = value reported in the research notes' cited literature (re-check against the original before quoting); <b>ASSUMPTION</b> = our modelling choice.
      </p>
      <div className="eqs">
        <h3>Core equations</h3>
        <ul>
          <li>
            Pre-movement: phases <i>recognition → response → preparation</i>, each τ ~ LogNormal(ln m, σ) with <i>m</i> = m₀ · L<sub>level</sub> · exp(β<sub>aisle</sub> d<sub>aisle</sub> + β<sub>exit</sub> d<sub>door</sub>/10 − β<sub>fam</sub> 1[familiar]).
            Social clock dc/dt = 1 + κ φ<sub>i</sub>(t); unaware agents also become aware with hazard λ<sub>s</sub> φ<sub>i</sub>(t); φ = share of seated neighbours (r ≤ 2.5 m) standing or moving.
          </li>
          <li>
            Exit choice (multinomial logit): U<sub>ig</sub> = −w<sub>T</sub> T<sub>ig</sub>/30 + w<sub>F</sub> F<sub>g</sub> + w<sub>S</sub> S<sub>ig</sub> + 3 w<sub>G</sub> G<sub>ig</sub> + w<sub>I</sub> 1[g = current] + ε, ε ~ Gumbel; T<sub>ig</sub> from a forward Dijkstra search with link
            cost τ<sub>l</sub>·1.2/v₀ + (w<sub>Q</sub>/w<sub>T</sub>) q<sub>l</sub>/C<sub>l</sub> · ν(w) + κ<sub>cf</sub> n<sub>opp</sub>/lanes (only visible queues count).
          </li>
          <li>
            Gates (doors / stairs): token bucket with capacity C = q · w<sub>eff</sub> · f<sub>luggage</sub> · f<sub>env</sub> · g(u, π), w<sub>eff</sub> = w − 2b; g = (1 + a u)(1 − d·max(0, (π − θ)/(1 − θ))²), π = u · mean impatience in the queue.
            Passes in any interval T ≤ ∫C dt + 1.
          </li>
          <li>
            Movement along lanes: v ≤ min(v₀ · terrain · env, (h − d<sub>min</sub>)/T<sub>h</sub>) with headway h to the lane leader, d<sub>min</sub> = r<sub>i</sub> + r<sub>j</sub>; seat rows ≤ 0.45 m/s, squeezing past seated people 0.2 m/s; opposing flow divides speed by 1 + c ρ<sub>opp</sub>.
          </li>
          <li>
            Monte Carlo: T̄ ± t<sub>0.975,R−1</sub> s/√R; P(T ≤ 180 s) with Wilson interval (unfinished runs count as failures); paired differences D<sub>r</sub> = T<sub>r</sub><sup>B</sup> − T<sub>r</sub><sup>A</sup> on common seeds.
          </li>
        </ul>
      </div>
      <div className="card">
        <h3>Dynamic behaviour and adaptive Crowd Managers (optional, docs/ADAPTIVE.md)</h3>
        <pre className="eq">{`U_i(g,t) = -wT(1+k u_i) T_ig/30 - wU(1-c_ig) + wF(1-k u_i) F_g + wS s_i S_ig
          + 3 wG (0.75+0.5 coop_i) G_ig + wI 1[g = current] + eps_ig
T_ig = perceived route time + max(0, remembered wait x e^(-age/60 s) - wait seen now)
re-evaluate when: queuing > max(12 s, 1.5 x expected) | visible queue > expected + max(10 s, 50%)
                 | new closure | new Crowd Manager instruction   (commitment 10 s, cooldown 6 s)
manager:  est(g) = walk + known waits + announced/own load / capacity(g);
          switch if > 20 s better after >= 20 s hold; return to plan when no worse;
          one lead per planned exit among managers whose voice areas overlap`}</pre>
        <p className="small muted">
          Off by default (previous fixed model, reproduced exactly). Walls block sight and voice in the adaptive mode; managers only know what they observe or hear by radio. All
          magnitudes are assumptions. Density over time: ρ_A(t) = N_A(t) / Area(A) on 19 regions; exposure E_i = ∫ max(0, ρ − ρ_ref) dt with ρ_ref = 2 p/m² as an analytical reference, not a
          safety limit.
        </p>
      </div>
      <h3>Parameters and sources</h3>
      <table className="data">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value / meaning</th>
            <th>Status</th>
            <th>Source</th>
            <th>Uncertainty</th>
          </tr>
        </thead>
        <tbody>
          {PARAM_INFO.map((p) => (
            <tr key={p.path + p.label}>
              <td>
                <code>{p.path}</code>
              </td>
              <td>{p.label}</td>
              <td>
                <span className={`status ${p.status.toLowerCase()}`}>{p.status}</span>
              </td>
              <td>{p.source}</td>
              <td>{p.uncertainty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Important limitations</h3>
      <ul>
        <li>Geometry is reconstructed from scanned plans (~6% scale uncertainty); door and stair widths are estimates; backstage stage-escape routes are schematic.</li>
        <li>Behavioural parameters are not calibrated to Bailey Hall; results are comparative (strategy A vs B under the same assumptions), not predictions of real evacuation times.</li>
        <li>Smoke, darkness and falls are simplified stress tests, not validated physical models. Wheelchair users are not counted as safe: the assisted-evacuation procedure is unknown.</li>
        <li>Ground level, performer areas and service spaces are ignored, as instructed by the problem statement.</li>
      </ul>
    </div>
  );
}
