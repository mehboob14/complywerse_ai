'use client';

// Shared types + small badge components for the Advisory pages. Kept inside the
// feature folder so the whole module stays self-contained.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Download, ArrowLeft, Play, History } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { advisoriesApi, assetsApi, ctemScopesApi } from '@/cyber-assurance/lib/api';

export interface AdvisoryApplicabilityRow {
  asset_id: number;
  verdict: string;
  evidence?: Record<string, unknown>;
}

export interface AdvisoryCveView {
  id: number;
  cve_id: string;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
  cvss_score?: number | null;
  kev?: boolean;
  affected_product?: string | null;
  affected_versions?: string | null;
  bridged_vulnerability_id?: number | null;
  applicability?: {
    affected_count: number;
    not_affected_count: number;
    affected_asset_ids: number[];
    affected_assets?: { id: number; name: string }[];
    not_affected_asset_ids: number[];
    rows: AdvisoryApplicabilityRow[];
  };
}

export interface PdfSource {
  key: string;
  name: string;
  region: string;
  auto: boolean;
}

export interface ExtractionStage {
  stage: string;
  engine?: string;
  status: string;
  chars?: number;
  cves?: number;
  tables?: number;
  confidence?: string;
  ai_used?: boolean;
  detail?: string;
}

export interface ExtractionReport {
  method: string;
  confidence: string;
  warnings: string[];
  stages: ExtractionStage[];
}

export interface FlowStage {
  key: string;
  label: string;
  status: string;
  detail: string;
}

export interface AdvisoryFlow {
  stages: FlowStage[];
  current: string;
}

export interface AdvisoryEventView {
  id: number;
  event: string;
  detail?: Record<string, unknown>;
  actor?: string | null;
  at?: string | null;
}

export interface AdvisoryView {
  id: number;
  external_id?: string | null;
  title: string;
  summary?: string | null;
  severity?: string | null;
  url?: string | null;
  status: string;
  source_id?: number | null;
  source_name?: string | null;
  region?: string | null;
  origin?: string | null;
  cve_count: number;
  asset_affected_count: number;
  asset_total_count: number;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  cves?: AdvisoryCveView[];
  flow?: AdvisoryFlow;
  extraction?: ExtractionReport | null;
  history?: AdvisoryEventView[];
}

export interface AdvisoryListResponse {
  advisories: AdvisoryView[];
  summary: Record<string, number>;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-50 text-red-600',
  high: 'bg-orange-50 text-orange-600',
  medium: 'bg-yellow-50 text-yellow-700',
  low: 'bg-blue-50 text-blue-600',
  info: 'bg-gray-100 text-gray-600',
};

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-red-50 text-red-600',
  not_applicable: 'bg-green-50 text-green-700',
  resolved: 'bg-green-50 text-green-700',
  pending: 'bg-yellow-50 text-yellow-700',
};

const VERDICT_STYLE: Record<string, string> = {
  affected: 'bg-red-50 text-red-600',
  not_affected: 'bg-green-50 text-green-700',
  fixed: 'bg-blue-50 text-blue-600',
  unknown: 'bg-gray-100 text-gray-600',
};

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity?: string | null }) {
  const key = (severity || 'info').toLowerCase();
  return <Pill label={key} cls={SEVERITY_STYLE[key] || SEVERITY_STYLE.info} />;
}

export function StatusBadge({ status }: { status: string }) {
  const key = (status || 'open').toLowerCase();
  const label = key === 'not_applicable' ? 'not applicable' : key;
  return <Pill label={label} cls={STATUS_STYLE[key] || 'bg-gray-100 text-gray-600'} />;
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const key = (verdict || 'unknown').toLowerCase();
  const label = key === 'not_affected' ? 'not affected' : key;
  return <Pill label={label} cls={VERDICT_STYLE[key] || VERDICT_STYLE.unknown} />;
}

// Advisory summaries (esp. from GitHub) arrive as Markdown — render it so
// headings, bullet points and links read properly instead of showing raw "###".
export function RichText({ text }: { text?: string | null }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="prose prose-sm max-w-none break-words prose-headings:mb-1 prose-headings:mt-3 prose-headings:text-sm prose-headings:font-semibold prose-p:my-1.5 prose-a:text-[var(--color-primary)] prose-code:text-[var(--color-primary)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

// ── Per-CVE card ────────────────────────────────────────────────────────────
// A CVE on an advisory *is* a vulnerability: it's tracked in the register, so
// the card links to that register detail for the full picture. Shows the
// enriched title/severity/description + which of your assets a register finding
// reports this CVE on.
export function VulnCard({ cve, selected, onToggleSelect }: {
  cve: AdvisoryCveView;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const ap = cve.applicability;
  const linked = !!cve.bridged_vulnerability_id;
  const affected = ap?.affected_assets ?? [];
  const body = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold cw-text-default">{cve.cve_id}</span>
            {cve.severity && <SeverityBadge severity={cve.severity} />}
            {typeof cve.cvss_score === 'number' && (
              <span className="text-[11px] cw-text-muted">CVSS {cve.cvss_score.toFixed(1)}</span>
            )}
            {cve.kev && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700" title="CISA Known Exploited Vulnerability">KEV</span>
            )}
          </div>
          {cve.title && cve.title !== cve.cve_id && (
            <p className="mt-0.5 text-xs font-medium cw-text-default">{cve.title}</p>
          )}
          {(cve.affected_product || cve.affected_versions) && (
            <p className="mt-0.5 text-[11px] cw-text-muted">
              {cve.affected_product || 'product n/a'}{cve.affected_versions ? ` · ${cve.affected_versions}` : ''}
            </p>
          )}
        </div>
        {linked && <span className="shrink-0 text-[11px] font-medium text-[var(--color-primary)]">Full details →</span>}
      </div>
      {cve.description && (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed cw-text-muted">{cve.description}</p>
      )}
      <div className="mt-2.5 border-t border-[var(--color-border)] pt-2">
        <p className="mb-1 text-[11px] font-semibold cw-text-muted">Affected assets ({ap?.affected_count ?? 0})</p>
        {affected.length === 0 ? (
          <span className="text-[11px] cw-text-muted">No asset in the checked scope has a finding for this CVE.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {affected.map((a) => (
              <span key={a.id} className="inline-flex rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">{a.name}</span>
            ))}
          </div>
        )}
      </div>
    </>
  );
  const cls = 'block flex-1 rounded-lg border border-[var(--color-border)] p-3';
  const card = linked ? (
    <Link href={`/cyber-assurance/vulnerabilities/${cve.bridged_vulnerability_id}`}
      className={`${cls} transition-colors hover:border-[var(--color-primary)]`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
  if (!onToggleSelect) return card;
  return (
    <div className="flex items-start gap-2">
      <input type="checkbox" className="mt-3.5 shrink-0" checked={!!selected} onChange={onToggleSelect} />
      {card}
    </div>
  );
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-green-50 text-green-700',
  medium: 'bg-yellow-50 text-yellow-700',
  low: 'bg-red-50 text-red-600',
};

export function ConfidenceBadge({ confidence }: { confidence?: string | null }) {
  const key = (confidence || 'low').toLowerCase();
  return <Pill label={`${key} confidence`} cls={CONFIDENCE_STYLE[key] || CONFIDENCE_STYLE.low} />;
}

const STAGE_DOT: Record<string, string> = {
  done: 'bg-green-500',
  current: 'bg-blue-500',
  pending: 'bg-gray-300',
  weak: 'bg-yellow-500',
  unavailable: 'bg-gray-300',
  empty: 'bg-yellow-500',
  review: 'bg-yellow-500',
};

function stageDetail(s: ExtractionStage): string {
  const bits: string[] = [];
  if (s.engine) bits.push(s.engine);
  if (typeof s.cves === 'number') bits.push(`${s.cves} CVE`);
  if (typeof s.tables === 'number' && s.tables > 0) bits.push(`${s.tables} tbl`);
  if (typeof s.chars === 'number') bits.push(`${s.chars} ch`);
  if (s.confidence) bits.push(s.confidence);
  if (s.detail) bits.push(s.detail);
  return bits.join(' · ');
}

export function ExtractionPipeline({ report }: { report: ExtractionReport }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider cw-text-muted">Parsing pipeline</p>
        <div className="flex items-center gap-2">
          <span className="text-xs cw-text-muted">method: <span className="font-medium cw-text-default">{report.method}</span></span>
          <ConfidenceBadge confidence={report.confidence} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-stretch gap-2">
        {report.stages.map((s, i) => (
          <div key={`${s.stage}-${i}`} className="flex items-center gap-2 rounded-md bg-[var(--color-subtle)] px-2.5 py-1.5">
            <span className={`h-2 w-2 rounded-full ${STAGE_DOT[s.status] || 'bg-gray-300'}`} />
            <div className="leading-tight">
              <p className="text-xs font-medium capitalize cw-text-default">{s.stage.replace('_', ' ')}</p>
              <p className="text-[11px] cw-text-muted">{stageDetail(s)}</p>
            </div>
          </div>
        ))}
      </div>
      {report.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {report.warnings.map((w, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-yellow-700">
              <span aria-hidden>⚠</span><span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FLOW_DOT: Record<string, string> = {
  done: 'bg-green-500 text-white',
  current: 'bg-blue-500 text-white',
  pending: 'bg-[var(--color-subtle)] cw-text-muted',
};

export function FlowStrip({ flow }: { flow: AdvisoryFlow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {flow.stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${FLOW_DOT[s.status] || FLOW_DOT.pending}`}
            title={s.detail}>
            {s.label}
          </div>
          {i < flow.stages.length - 1 && <span className="cw-text-muted">›</span>}
        </div>
      ))}
    </div>
  );
}

const EVENT_META: Record<string, { label: string; dot: string }> = {
  ingested: { label: 'Ingested', dot: 'bg-blue-500' },
  confirmed: { label: 'Confirmed', dot: 'bg-green-500' },
  bridged: { label: 'Tracked in register', dot: 'bg-green-500' },
  rechecked: { label: 'Re-checked', dot: 'bg-purple-500' },
  updated: { label: 'Updated', dot: 'bg-amber-500' },
  status_change: { label: 'Status changed', dot: 'bg-gray-500' },
};

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function eventSummary(e: AdvisoryEventView): string {
  const d = e.detail || {};
  switch (e.event) {
    case 'ingested': {
      const origin = str(d.origin);
      const bits: string[] = [];
      if (origin === 'upload') bits.push('uploaded');
      else if (origin === 'scrape') bits.push(`scraped${str(d.source) ? ` from ${d.source}` : ''}`);
      else if (origin === 'api') bits.push(`pulled${str(d.source) ? ` from ${d.source}` : ''}`);
      else if (origin === 'manual') bits.push('entered manually');
      if (str(d.method)) bits.push(str(d.method) as string);
      if (str(d.confidence)) bits.push(`${d.confidence} confidence`);
      const c = num(d.cves);
      if (c !== undefined) bits.push(`${c} CVE${c === 1 ? '' : 's'}`);
      return bits.join(' · ');
    }
    case 'confirmed': {
      const c = num(d.cves);
      return c !== undefined ? `${c} CVE${c === 1 ? '' : 's'} confirmed` : '';
    }
    case 'bridged': {
      const c = num(d.count);
      return c !== undefined ? `${c} vulnerabilit${c === 1 ? 'y' : 'ies'}` : '';
    }
    case 'rechecked': {
      if (!d.evaluated) return 'no inventory match yet';
      return `${num(d.affected) ?? 0} of ${num(d.total) ?? 0} assets affected`;
    }
    case 'updated': {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]).join(', ') : '';
      const src = str(d.source);
      return [fields && `changed: ${fields}`, src && `from ${src}`].filter(Boolean).join(' · ');
    }
    default:
      return '';
  }
}

// The ingest event is recorded for every origin, but the word should match how
// the advisory actually arrived: a feed is "Synced", not "Ingested".
const INGEST_LABEL: Record<string, string> = {
  upload: 'Uploaded', scrape: 'Ingested', api: 'Synced', manual: 'Added',
};
function eventLabel(e: AdvisoryEventView): string {
  if (e.event === 'ingested') {
    return INGEST_LABEL[str(e.detail?.origin) ?? ''] ?? 'Synced';
  }
  return EVENT_META[e.event]?.label ?? e.event;
}

// Absolute date + time with the year, so an event is never ambiguous.
function formatWhen(at?: string | null): string {
  if (!at) return '';
  const dt = new Date(at);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// The advisory's event history as a stack of cards (same card language as the
// CVE cards): ingested → confirmed → re-checked, each with an absolute date and
// the actor. Oldest first.
export function HistoryTimeline({ events }: { events: AdvisoryEventView[] }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="cw-card p-3">
      <h2 className="text-sm font-semibold cw-text-default">Timeline</h2>
      <p className="mt-0.5 text-[11px] cw-text-muted">Everything that has happened to this advisory, oldest first.</p>
      <div className="mt-3 space-y-2">
        {events.map((e) => {
          const dot = EVENT_META[e.event]?.dot ?? 'bg-gray-400';
          const summary = eventSummary(e);
          return (
            <div key={e.id} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold cw-text-default">{eventLabel(e)}</p>
                    {summary ? <p className="mt-0.5 text-[11px] cw-text-muted">{summary}</p> : null}
                  </div>
                </div>
                <span className="shrink-0 whitespace-nowrap text-[11px] cw-text-muted">{formatWhen(e.at) || '—'}</span>
              </div>
              {e.actor && <p className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[11px] cw-text-muted">by {e.actor}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Match-scope picker ──────────────────────────────────────────────────────
// Which assets to match this advisory's CVEs against: all scanned assets, a
// saved CTEM scope, or a hand-picked set. Parent owns the recheck mutation.
export interface RecheckScope { mode?: string; ctem_scope_id?: number; asset_ids?: number[] }

interface MinAsset { id: number; name: string; host_name?: string | null; ip_address?: string | null }
interface MinScope { id: number; name: string }

export function MatchScopeControl({ onRecheck, isPending }: {
  onRecheck: (scope: RecheckScope) => void;
  isPending: boolean;
}) {
  const [mode, setMode] = useState<'all' | 'scope' | 'assets'>('all');
  const [scopeId, setScopeId] = useState<number | ''>('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const { data: scopesRaw } = useQuery({
    queryKey: ['advisory-ctem-scopes'],
    queryFn: async () => (await ctemScopesApi.list()).data,
    enabled: mode === 'scope',
  });
  const { data: assetsRaw } = useQuery({
    queryKey: ['advisory-asset-list'],
    queryFn: async () => (await assetsApi.getAll()).data,
    enabled: mode === 'assets',
  });
  const scopeList: MinScope[] = Array.isArray(scopesRaw) ? scopesRaw : ((scopesRaw as { scopes?: MinScope[] })?.scopes ?? []);
  const assetList: MinAsset[] = Array.isArray(assetsRaw) ? assetsRaw : [];

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const run = () => {
    if (mode === 'scope') onRecheck({ mode, ctem_scope_id: scopeId ? Number(scopeId) : undefined });
    else if (mode === 'assets') onRecheck({ mode, asset_ids: Array.from(picked) });
    else onRecheck({ mode: 'all' });
  };

  const blocked = isPending || (mode === 'scope' && !scopeId) || (mode === 'assets' && picked.size === 0);

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <p className="mb-2 text-xs font-semibold cw-text-default">Check against</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'all' | 'scope' | 'assets')}
          className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1.5 text-sm cw-text-default">
          <option value="all">All scanned assets</option>
          <option value="scope">A saved asset group (CTEM scope)</option>
          <option value="assets">Specific assets…</option>
        </select>
        {mode === 'scope' && (
          <select value={scopeId} onChange={(e) => setScopeId(e.target.value ? Number(e.target.value) : '')}
            className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1.5 text-sm cw-text-default">
            <option value="">Pick a scope…</option>
            {scopeList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <button onClick={run} disabled={blocked} className="btn-secondary flex items-center gap-1.5">
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Re-check
        </button>
      </div>
      {mode === 'assets' && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
          {assetList.length === 0 ? (
            <p className="text-xs cw-text-muted">No assets in inventory.</p>
          ) : (
            assetList.map((a) => (
              <label key={a.id} className="flex items-center gap-2 py-0.5 text-sm cw-text-default">
                <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="truncate">{a.name}{(a.host_name || a.ip_address) ? <span className="cw-text-muted"> · {a.host_name || a.ip_address}</span> : null}</span>
              </label>
            ))
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] cw-text-muted">
        Matches this advisory&apos;s CVEs against the chosen assets&apos; findings in your vulnerability register.
      </p>
    </div>
  );
}

// ── Region picker ───────────────────────────────────────────────────────────
// Operator picks the region for an upload the classifier couldn't place. The
// region list is the hardcoded canonical set (all countries + Global/US/UK/EU).
export function RegionPicker({ advisoryId, current }: { advisoryId: number; current?: string | null }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['advisory-regions'],
    queryFn: async () => (await advisoriesApi.listRegions()).data as { regions: string[] },
  });
  const mut = useMutation({
    mutationFn: (region: string) => advisoriesApi.setRegion(advisoryId, region),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advisory', advisoryId] });
      qc.invalidateQueries({ queryKey: ['advisories'] });
    },
  });
  const regions = (data?.regions ?? []).filter((r) => r !== 'Unclassified');
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        defaultValue=""
        disabled={mut.isPending}
        onChange={(e) => e.target.value && mut.mutate(e.target.value)}
        className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs cw-text-default"
      >
        <option value="">{current && current !== 'Unclassified' ? `Region: ${current}` : 'Pick region…'}</option>
        {regions.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {mut.isPending && <Loader2 size={12} className="animate-spin cw-text-muted" />}
    </span>
  );
}

// ── Match: types + panel + report + history ─────────────────────────────────
export interface MatchAsset { id: number; name: string; severity?: string | null; vulnerability_id?: number | null }
export interface MatchedCve { cve_id: string; advisory_id: number; advisory_title?: string | null; assets: MatchAsset[] }
export interface NotFoundCve { cve_id: string; advisory_id: number; advisory_title?: string | null }
export interface MatchSummary { cves_checked: number; matched: number; not_found: number; scope_size: number }
export interface MatchReportData { summary: MatchSummary; matched: MatchedCve[]; not_found: NotFoundCve[] }
export interface MatchSessionRow { id: number; label?: string | null; actor?: string | null; created_at?: string | null; summary: MatchSummary }
export interface MatchTarget { mode: string; asset_ids?: number[] }

interface MinMatchAsset { id: number; name: string; host_name?: string | null; ip_address?: string | null }

// Run a match on the current selection. Target = all scanned assets, or a
// hand-picked set whose list opens right here in the panel. No CTEM.
export function MatchPanel({ selection, onRun, onCancel, isPending }: {
  selection: { advisories: number; cves: number };
  onRun: (target: MatchTarget) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [mode, setMode] = useState<'all' | 'assets'>('all');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { data: assetsRaw } = useQuery({
    queryKey: ['advisory-asset-list'],
    queryFn: async () => (await assetsApi.getAll()).data,
    enabled: mode === 'assets',
  });
  const assetList: MinMatchAsset[] = Array.isArray(assetsRaw) ? assetsRaw : [];
  const toggle = (id: number) => setPicked((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const blocked = isPending || (mode === 'assets' && picked.size === 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold cw-text-default">Run match</h2>
        <div className="flex items-center gap-2.5">
          <button onClick={onCancel} className="text-xs cw-text-muted hover:cw-text-default">Cancel</button>
          <button
            onClick={() => onRun(mode === 'assets' ? { mode, asset_ids: Array.from(picked) } : { mode: 'all' })}
            disabled={blocked}
            className="btn-primary flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run match
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs leading-relaxed cw-text-muted">
        Matching <span className="font-semibold cw-text-default">{selection.cves}</span> CVE{selection.cves === 1 ? '' : 's'}
        {selection.advisories > 0 ? <> from <span className="font-semibold cw-text-default">{selection.advisories}</span> advisor{selection.advisories === 1 ? 'y' : 'ies'}</> : null} against your register.
      </p>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-xs cw-text-default">
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> All scanned assets
        </label>
        <label className="flex items-center gap-2 text-xs cw-text-default">
          <input type="radio" checked={mode === 'assets'} onChange={() => setMode('assets')} /> Specific assets
        </label>
      </div>

      {mode === 'assets' && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] p-2">
          {assetList.length === 0 ? (
            <p className="text-xs cw-text-muted">No assets in inventory.</p>
          ) : assetList.map((a) => (
            <label key={a.id} className="flex items-center gap-2 py-0.5 text-sm cw-text-default">
              <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
              <span className="truncate">{a.name}{(a.host_name || a.ip_address) ? <span className="cw-text-muted"> · {a.host_name || a.ip_address}</span> : null}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtWhen(at?: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

// Results of one match run: summary, a card per matched CVE (each affected asset
// links to its asset page + its register finding), and the CVEs with no finding.
export function MatchReport({ report, title, onBack, onDownload }: {
  report: MatchReportData;
  title?: string;
  onBack: () => void;
  onDownload?: (fmt: 'csv' | 'json') => void;
}) {
  const s = report.summary;
  const stats = [
    { label: 'CVEs checked', value: s.cves_checked, accent: false },
    { label: 'Matched', value: s.matched, accent: true },
    { label: 'Not found', value: s.not_found, accent: false },
    { label: 'Assets in scope', value: s.scope_size, accent: false },
  ];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs cw-text-muted hover:cw-text-default">
          <ArrowLeft size={14} /> Back
        </button>
        {onDownload && (
          <div className="flex items-center gap-2">
            <button onClick={() => onDownload('csv')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13} /> CSV</button>
            <button onClick={() => onDownload('json')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13} /> JSON</button>
          </div>
        )}
      </div>

      <h2 className="mt-2.5 text-sm font-semibold cw-text-default">{title || 'Match report'}</h2>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((st) => (
          <div key={st.label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-2">
            <p className={`text-xl font-semibold leading-tight ${st.accent ? 'text-red-600' : 'cw-text-default'}`}>{st.value}</p>
            <p className="mt-0.5 text-[11px] cw-text-muted">{st.label}</p>
          </div>
        ))}
      </div>

      {report.matched.length === 0 ? (
        <p className="mt-4 text-xs cw-text-muted">No selected CVE was found on any asset in the chosen scope.</p>
      ) : (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold cw-text-default">Matched — found on your assets</h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide">
                  <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">CVE</th>
                  <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">Affected assets</th>
                  <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">Advisory</th>
                </tr>
              </thead>
              <tbody>
                {report.matched.map((m) => (
                  <tr key={`${m.advisory_id}-${m.cve_id}`} className="border-b border-[var(--color-border)] align-top last:border-0">
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs font-semibold cw-text-default">{m.cve_id}</span>
                      {m.advisory_title && <p className="mt-0.5 text-[11px] cw-text-muted">{m.advisory_title}</p>}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-col gap-1">
                        {m.assets.map((a) => (
                          <div key={a.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                            <a href={`/cyber-assurance/assets/${a.id}`} target="_blank" rel="noopener noreferrer"
                              className="font-medium text-[var(--color-primary)] hover:underline">{a.name}</a>
                            <SeverityBadge severity={a.severity} />
                            {a.vulnerability_id && (
                              <a href={`/cyber-assurance/vulnerabilities/${a.vulnerability_id}`} target="_blank" rel="noopener noreferrer"
                                className="text-[var(--color-primary)] hover:underline">Open finding →</a>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <a href={`/cyber-assurance/advisories/${m.advisory_id}`} target="_blank" rel="noopener noreferrer"
                        className="whitespace-nowrap text-[11px] font-medium text-[var(--color-primary)] hover:underline">Open →</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Saved match sessions — re-open or download a past run.
export function MatchHistory({ onOpen, onBack }: { onOpen: (id: number) => void; onBack: () => void }) {
  const { data } = useQuery({
    queryKey: ['advisory-match-sessions'],
    queryFn: async () => (await advisoriesApi.listMatchSessions()).data as { sessions: MatchSessionRow[] },
  });
  const sessions = data?.sessions ?? [];
  const download = async (id: number) => {
    try {
      const res = await advisoriesApi.downloadMatchSession(id, 'csv');
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = `match-session-${id}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };
  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs cw-text-muted hover:cw-text-default">
        <ArrowLeft size={14} /> Back
      </button>
      <h2 className="mt-2 flex items-center gap-2 text-sm font-semibold cw-text-default"><History size={15} /> Match history</h2>
      <p className="mt-0.5 text-xs cw-text-muted">Every match run is saved here. Open one to see its full report, or download it.</p>
      {sessions.length === 0 ? (
        <p className="mt-3 text-xs cw-text-muted">No match runs yet. Select advisories or CVEs and run a match.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide">
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">Run</th>
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">When</th>
                <th className="px-3 py-2 font-bold !bg-primary-700 !text-white">By</th>
                <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">CVEs</th>
                <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">Matched</th>
                <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">Not found</th>
                <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">Scope</th>
                <th className="px-3 py-2 text-right font-bold !bg-primary-700 !text-white">Export</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-hover)]">
                  <td className="px-3 py-1.5">
                    <button onClick={() => onOpen(row.id)} className="font-medium text-[var(--color-primary)] hover:underline">
                      {row.label || `Match #${row.id}`}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 cw-text-muted">{fmtWhen(row.created_at)}</td>
                  <td className="px-3 py-1.5 cw-text-muted">{row.actor || '—'}</td>
                  <td className="px-3 py-1.5 text-right cw-text-default">{row.summary?.cves_checked ?? 0}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-red-600">{row.summary?.matched ?? 0}</td>
                  <td className="px-3 py-1.5 text-right cw-text-muted">{row.summary?.not_found ?? 0}</td>
                  <td className="px-3 py-1.5 text-right cw-text-muted">{row.summary?.scope_size ?? 0}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => download(row.id)} className="btn-secondary inline-flex items-center gap-1 text-xs">
                      <Download size={13} /> CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
