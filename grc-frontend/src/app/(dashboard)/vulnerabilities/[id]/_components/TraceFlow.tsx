'use client';

/**
 * TraceFlow — the engine's reasoning, standing still. The "show the reasoning"
 * flow view: it renders the stage-by-stage path the engine actually took to its
 * verdict, driven by GET /exploitability/trace (read-only; never writes a snapshot).
 *
 * Every node is the endpoint's real output — classify → map (with the CAPEC hit or
 * MISS) → cvss/assumed → select → reach → verdict. `why` strings render RAW: the CSS
 * wraps them, it never truncates. A reason too long for its space wraps or expands;
 * it is never shortened, so the truth survives engine → endpoint → pixel.
 *
 * This is the STATIC frame in-app — the same thing the signed-off prototype showed,
 * now on live data. Motion, if it comes, is a reveal layered over this; the frame is
 * always here at rest.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import styles from './TraceFlow.module.css';

type Stage = any;

function verdictClass(v: string, entryState: string) {
  if (entryState === 'assumed_insufficient') return styles.vInsufficient;
  if (v === 'likely') return styles.vLikely;
  if (v === 'possible') return styles.vPossible;
  return styles.vUnlikely;
}
function verdictLabel(v: string, entryState: string) {
  return entryState === 'assumed_insufficient' ? 'INSUFFICIENT' : (v || '').toUpperCase();
}
const SRC_CLASS: Record<string, string> = {
  analyst: styles.srcAnalyst, cvss_derived: styles.srcCvss, capec_chain: styles.srcCapec,
  capec_via_parent: styles.srcCapecParent,
};
// How each source reads in the select-stage badge. capec_via_parent would otherwise
// print raw; give it a short human label. Others keep the terse engine name.
const SRC_LABEL: Record<string, string> = { capec_via_parent: 'capec (parent)' };
function srcLabel(s: string) {
  return SRC_LABEL[s] || (s || '').replace('_derived', '');
}
const ST_CLASS: Record<string, string> = {
  likely: styles.stLikely, possible: styles.stPossible, blocked: styles.stBlocked,
  // 'severed' — a downstream step the chain can't reach (entry door shut). Muted like
  // blocked; the label text ('severed') distinguishes it from a self-blocked step.
  severed: styles.stBlocked,
};

export default function TraceFlow({
  vulnId, assetId, cveId, assetName,
}: { vulnId: number; assetId?: number; cveId?: string; assetName?: string }) {
  const trace = useQuery({
    queryKey: ['exploit-trace', vulnId, assetId],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.exploitabilityTrace(vulnId, assetId as number)).data as any,
    enabled: !!assetId,
    staleTime: 60 * 1000,
  });
  // Replay key: bumping it remounts the flow, which restarts the CSS reveal from the
  // top. The reveal is a stagger over DOM order — and DOM order IS the trace's real
  // order — so the motion can only ever walk the stages the engine actually emitted;
  // it can't perform a beat the trace didn't produce. prefers-reduced-motion (handled
  // in the stylesheet) drops the animation entirely and shows the full frame at rest.
  const [playKey, setPlayKey] = useState(0);

  if (!assetId) {
    return (
      <div className={styles.wrap}>
        <div className={styles.state}>Link an affected asset on the Analysis tab to trace the reasoning on live data.</div>
      </div>
    );
  }
  if (trace.isError) {
    return (
      <div className={styles.wrap}>
        <div className={styles.state}>
          Couldn&apos;t load the reasoning trace — a display error, not an empty result.
          <button type="button" className={styles.retry} onClick={() => trace.refetch()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!trace.data) {
    return (
      <div className={styles.wrap}>
        <div className={styles.state}><span className={styles.spin} /> Tracing the reasoning…</div>
      </div>
    );
  }

  const stages: Stage[] = trace.data.stages || [];
  const reach = stages.find((s) => s.stage === 'reach');
  const exposed = reach?.signals?.internet_exposed;

  const StageRow = ({ label, dot, children }: any) => (
    <div className={styles.stage}>
      <div className={styles.rail}><span className={dot} /><span className={styles.lbl}>{label}</span></div>
      <div>{children}</div>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h3>How the engine reached this verdict</h3>
        <span className={styles.subtle}>the engine&apos;s real path — it plays once, then rests. every node is its output, verbatim.</span>
        <button type="button" className={styles.replay} onClick={() => setPlayKey((k) => k + 1)} aria-label="Replay the reveal">
          &#9654; Replay
        </button>
      </div>

      <div className={styles.flow} key={playKey}>
        <StageRow label="finding" dot={styles.dot}>
          <div className={`${styles.card} ${styles.row}`}>
            <span className={styles.cve}>{cveId || `VULN-${vulnId}`}</span>
            {assetName && <span className={styles.meta}>on {assetName}</span>}
            {exposed === true && <span className={`${styles.pill} ${styles.pillExposed}`}>internet-facing</span>}
            {exposed === false && <span className={`${styles.pill} ${styles.pillInternal}`}>internal</span>}
            {exposed == null && <span className={styles.pill}>exposure unknown</span>}
          </div>
        </StageRow>

        {stages.map((s, i) => {
          if (s.stage === 'classify') {
            return (
              <StageRow key={i} label="classify" dot={styles.dot}>
                <div className={`${styles.card} ${styles.row}`}>
                  {s.resolved
                    ? <><span className={styles.meta}>the CVE resolves to a weakness &rarr;</span>
                        {(s.cwes || []).map((c: string) => <span key={c} className={styles.idBadge}>{c}</span>)}</>
                    : <span className={styles.meta}>no CWE recorded for this finding &mdash; nothing to map from</span>}
                </div>
              </StageRow>
            );
          }
          if (s.stage === 'map') {
            return (
              <StageRow key={i} label={`map · ${s.cwe}`} dot={styles.dot}>
                <div className={`${styles.card} ${styles.cardHi}`}>
                  <div className={styles.lane}>
                    <span className={styles.tag}>capec</span>
                    {s.capec.hit
                      ? <span className={styles.hit}><b>hit</b> &nbsp;{s.cwe} &rarr; {(s.capec.techniques || []).map((t: string) => <span key={t} className={styles.tid}>{t} </span>)}</span>
                      : <span className={styles.miss}><b>miss</b> &nbsp;CAPEC has no mapping for {s.cwe} &mdash; it drops the common web-app weaknesses</span>}
                  </div>
                  {s.parent_walk && (
                    <div className={styles.lane}>
                      <span className={styles.tag}>parent</span>
                      {s.parent_walk.hit
                        ? <span className={styles.hit}><b>climb</b> &nbsp;no direct CAPEC, so up to {s.parent_walk.via_parent_cwe}{s.parent_walk.parent_name ? ` (${s.parent_walk.parent_name})` : ''} &mdash; {s.parent_walk.depth === 1 ? 'its parent' : `${s.parent_walk.depth} levels up`} &rarr; {(s.parent_walk.techniques || []).map((t: string) => <span key={t} className={styles.tid}>{t} </span>)}</span>
                        : <span className={styles.miss}><b>miss</b> &nbsp;no mapped ancestor for {s.cwe} within the CWE tree</span>}
                    </div>
                  )}
                  <div className={styles.lane}>
                    <span className={styles.tag}>analyst</span>
                    {s.analyst.hit
                      ? <span className={styles.hit}><b>hit</b> &nbsp;the curated gap-filler restores {(s.analyst.techniques || []).map((t: string) => <span key={t} className={styles.tid}>{t} </span>)}</span>
                      : <span className={styles.miss}><b>miss</b> &nbsp;no curated pair for {s.cwe}</span>}
                  </div>
                </div>
              </StageRow>
            );
          }
          if (s.stage === 'cvss_rules') {
            return (
              <StageRow key={i} label="cvss rules" dot={styles.dot}>
                <div className={styles.card}>
                  <div className={styles.chips}>
                    {(s.fired || []).map((h: any, j: number) => (
                      <span key={j} className={styles.rulechip}>{h.metric} &rarr; {h.technique_id}</span>
                    ))}
                  </div>
                  <div className={styles.note}>the parsed vector is the backbone &mdash; it produces the entry-tactic techniques the verdict depends on</div>
                </div>
              </StageRow>
            );
          }
          if (s.stage === 'assumed') {
            return (
              <StageRow key={i} label="assumed" dot={styles.dot}>
                <div className={styles.card}>
                  <div className={styles.chips}>
                    {(s.techniques || []).map((t: string) => <span key={t} className={`${styles.rulechip} ${styles.srcAssumed}`}>{t}</span>)}
                  </div>
                  <div className={styles.note}>{s.note}</div>
                </div>
              </StageRow>
            );
          }
          if (s.stage === 'select') {
            return (
              <StageRow key={i} label="select" dot={styles.dot}>
                <div className={styles.card}>
                  <div className={styles.techs}>
                    {(s.techniques || []).map((t: any) => {
                      const others = (t.sources || []).filter((x: string) => x !== t.winner);
                      return (
                        <div key={t.technique_id} className={`${styles.tech} ${t.assumed ? styles.assumed : ''}`}>
                          <span className={styles.tid}>{t.technique_id}</span>
                          <span className={styles.nm}>{t.name}</span>
                          {(t.tactics || []).slice(0, 1).map((tc: string) => <span key={tc} className={styles.tac}>{tc}</span>)}
                          <span className={`${styles.src} ${t.assumed ? styles.srcAssumed : (SRC_CLASS[t.winner] || styles.srcCvss)}`}>
                            {t.assumed ? 'assumed' : `${srcLabel(t.winner)}${others.length ? ' › ' + others.map((o: string) => srcLabel(o)).join(' ') : ''}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </StageRow>
            );
          }
          if (s.stage === 'reach') {
            return (
              <StageRow key={i} label="reachability" dot={styles.dot}>
                <div className={styles.card}>
                  <div className={styles.signals}>
                    {sigChip('internet_exposed', s.signals.internet_exposed)}
                    {sigChip('public_exploit', s.signals.has_public_exploit)}
                    {sigChip('in_kev', s.signals.in_kev)}
                  </div>
                  <div className={styles.badges}>
                    {(s.badges || []).map((b: any) => (
                      <div key={b.technique_id} className={`${styles.badge} ${b.is_entry ? styles.entry : ''}`}>
                        <span className={styles.tid}>{b.technique_id}{b.is_entry && <span className={styles.entryTag}> entry</span>}</span>
                        <span className={`${styles.st} ${ST_CLASS[b.status] || styles.stPossible}`}>{b.status}</span>
                        <span className={styles.why}>{b.why}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </StageRow>
            );
          }
          if (s.stage === 'verdict') {
            const dv = s.entry_state === 'assumed_insufficient' ? styles.dotGrey
              : s.verdict === 'unlikely' ? styles.dotSafe : styles.dotEnd;
            return (
              <StageRow key={i} label="verdict" dot={`${styles.dot} ${dv}`}>
                <div className={`${styles.verdict} ${verdictClass(s.verdict, s.entry_state)}`}>
                  <span className={styles.v}>{verdictLabel(s.verdict, s.entry_state)}</span>
                  <span className={styles.vr}>{s.reason}</span>
                </div>
              </StageRow>
            );
          }
          return null;
        })}
      </div>

      <div className={styles.legend}>
        <div className={styles.lgroup}>
          <span className={styles.h}>verdict</span>
          <div className={styles.lrow}>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#f43f5e' }} />likely</span>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#f59e0b' }} />possible</span>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#10b981' }} />unlikely</span>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#64748b' }} />insufficient</span>
          </div>
        </div>
        <div className={styles.lgroup}>
          <span className={styles.h}>provenance</span>
          <div className={styles.lrow}>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#14b8a6' }} />standards (CAPEC)</span>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#0ea5e9' }} />standards (parent)</span>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#f59e0b' }} />CVSS</span>
            <span className={styles.lchip}><span className={styles.sw} style={{ background: '#6366f1' }} />analyst</span>
            <span className={styles.lchip}><span className={`${styles.sw} ${styles.swDashed}`} />assumed</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function sigChip(name: string, val: any) {
  const cls = val === false ? styles.sigNo : val == null ? styles.sigMuted : styles.sig;
  const shown = val === true ? 'true' : val === false ? 'false' : 'unknown';
  return <span key={name} className={`${styles.sig} ${cls}`}>{name} <b>{shown}</b></span>;
}
