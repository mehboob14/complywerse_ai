'use client';

/**
 * AI evidence recommendations for one assessment item, in a popup split in two.
 * Left: what evidence proves the item and how to collect it, plus records already
 * in the Evidence library that fit, each linkable in one click. Right: documents —
 * the recommended ones the AI can draft for this item on NIST guidance (Word, PDF,
 * or saved to Governance → Documents as a draft), matching documents from the
 * artifacts catalog, and the NIST publications that apply.
 *
 * Shared by every Cyber Security assessment tab. The result is kept on the item and
 * lands in the query cache even when the popup was closed meanwhile, so the row's
 * AI button shows it is working, then that recommendations are ready.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen, Check, Download, ExternalLink, Eye, EyeOff, FileText, FolderOpen, Library, Link2, Loader2,
  RefreshCw, Sparkles, X,
} from 'lucide-react';
import apiClient from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';

type DocKind = 'policy' | 'standard' | 'procedure' | 'plan' | 'report';
type Recommendation = {
  evidence_type: string; description: string; how_to_collect?: string;
  priority: 'high' | 'medium' | 'low' | string; example_files?: string[]; document?: DocKind | null;
};
type Match = {
  evidence_id: number; name: string; file_name?: string | null; evidence_type?: string | null;
  status?: string | null; reason?: string; confidence?: number;
};
type NistSource = { id: string; title: string; url: string; refs?: string; why?: string };
export type Reference = {
  artifact_id: string; framework_key: string; framework: string; title: string;
  type?: string | null; control_ref?: string | null; reason?: string;
};
type Draft = {
  title: string; kind: DocKind; status: 'drafting' | 'ready' | 'failed';
  content?: string; error?: string | null; generated_at?: string; document_id?: number | null;
  /** The official NIST template outline the draft follows, when one fits. */
  template?: string | null;
};
export type LibraryTemplate = { name: string; url: string; format: string; note?: string; drafts_follow?: boolean };
export type LibraryPublication = {
  id: string; title: string; url: string; summary?: string; status?: string; serves: string[]; templates: LibraryTemplate[];
};
type NistLibrary = { note?: string; publications: LibraryPublication[]; catalog: Reference[] };
type Result = {
  summary?: string; recommendations?: Recommendation[]; matches?: Match[]; library_checked?: number;
  nist?: NistSource[]; references?: Reference[]; drafts?: Record<string, Draft>;
};
type Saved = { recommendation: Result | null; generated_at: string | null };
type Item = { id: number; item_number?: string | null; control_description?: string | null };

const PRIORITY: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low: 'bg-slate-50 text-slate-600 ring-slate-200',
};
// Governance documents come in four types; a plan is kept as a procedure. A report template isn't one.
const GOVERNANCE_TYPE: Partial<Record<DocKind, string>> = {
  policy: 'policy', standard: 'standard', procedure: 'procedure', plan: 'procedure',
};
const STEPS = ['Reading the requirement', 'Checking your evidence library', 'Matching NIST guidance', 'Writing recommendations'];

const recKey = (assessmentId: number, itemId: number) => ['ai-evidence-recommendation', assessmentId, itemId];
const runKey = (assessmentId: number, itemId: number) => ['ai-evidence-run', assessmentId, itemId];
const base = (assessmentId: number, itemId: number) => `/compliance/assessments/${assessmentId}/items/${itemId}`;
const fetchSaved = async (assessmentId: number, itemId: number) =>
  (await apiClient.get(`${base(assessmentId, itemId)}/ai-recommendation`)).data as Saved;
const hasResult = (r?: Result | null) => !!r && ((r.recommendations?.length || 0) > 0 || (r.matches?.length || 0) > 0);
// The server's draft_key, so a recommendation finds its draft.
const draftKey = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
// Stored times are UTC without a zone; read them as UTC.
const when = (iso?: string | null) =>
  iso ? new Date(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).toLocaleString() : null;
const detailOf = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
};

async function download(url: string, params: Record<string, string>, filename: string) {
  const r = await apiClient.get(url, { params, responseType: 'blob' });
  const href = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** The NIST publications, official templates and catalog documents the advice draws on. */
export function useNistLibrary() {
  return useQuery({
    queryKey: ['nist-library'],
    queryFn: async () => (await apiClient.get('/compliance/assessments/nist-library')).data as NistLibrary,
    staleTime: Infinity,
  });
}

export function TemplateLink({ template }: { template: LibraryTemplate }) {
  return (
    <a href={template.url} target="_blank" rel="noreferrer noopener" title={template.note || 'Official NIST template'}
       className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] text-slate-600 hover:bg-slate-50">
      <Download className="h-3 w-3" /> {template.name}
      <span className="uppercase text-slate-400">{template.format}</span>
    </a>
  );
}

function useRun(assessmentId: number, itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: runKey(assessmentId, itemId),
    // The result goes into the cache here, not in onSuccess, so it lands even if the popup closed meanwhile.
    mutationFn: async () => {
      const data = (await apiClient.post(`${base(assessmentId, itemId)}/ai-recommendation`)).data as Saved;
      qc.setQueryData(recKey(assessmentId, itemId), data);
      return data;
    },
  });
}

/** The row's AI button: spins while the AI works on the item, and shows a dot once recommendations are ready. */
export function AiEvidenceButton({ assessmentId, itemId, active, onOpen }: {
  assessmentId: number; itemId: number; active: boolean; onOpen: () => void;
}) {
  const running = useIsMutating({ mutationKey: runKey(assessmentId, itemId) }) > 0;
  // Watches the item's cached result without fetching it: a request per row would be too many.
  const { data } = useQuery({
    queryKey: recKey(assessmentId, itemId), queryFn: () => fetchSaved(assessmentId, itemId), enabled: false,
  });
  const ready = hasResult(data?.recommendation);
  return (
    <button type="button" onClick={onOpen}
            title={running ? 'The AI is working on this item' : 'AI evidence recommendations for this item'}
            className="relative inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition"
            style={active ? { borderColor: '#7c3aed', color: '#6d28d9', backgroundColor: '#f5f3ff' } : { borderColor: '#ddd6fe', color: '#7c3aed' }}>
      {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} AI
      {ready && !running && (
        <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-violet-500 ring-2 ring-white" aria-label="Recommendations ready" />
      )}
    </button>
  );
}

function Progress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(t);
  }, []);
  return (
    <ol className="space-y-1.5" aria-live="polite">
      {STEPS.map((s, i) => (
        <li key={s} className={`flex items-center gap-2 text-[12px] ${i < step ? 'text-slate-400' : i === step ? 'text-slate-700' : 'text-slate-300'}`}>
          {i < step ? <Check className="h-3.5 w-3.5 text-emerald-500" />
            : i === step ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
              : <span className="inline-block h-3.5 w-3.5 rounded-full border border-slate-200" />}
          {s}{i === step ? '…' : ''}
        </li>
      ))}
    </ol>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="animate-pulse rounded-md border border-slate-100 p-2.5">
          <div className="h-3 w-2/5 rounded bg-slate-200" />
          <div className="mt-2 h-2.5 w-full rounded bg-slate-100" />
          <div className="mt-1.5 h-2.5 w-4/5 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-3.5 w-3.5" /> {children}
    </p>
  );
}

function DraftCard({ assessmentId, itemId, rec, draft, basis, context, itemNumber }: {
  assessmentId: number; itemId: number; rec: Recommendation; draft?: Draft; basis: string;
  context?: string; itemNumber?: string | null;
}) {
  const qc = useQueryClient();
  const key = draftKey(rec.evidence_type);
  const [preview, setPreview] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: recKey(assessmentId, itemId) });
  const start = useMutation({
    mutationFn: async () => (await apiClient.post(`${base(assessmentId, itemId)}/ai-drafts`, { title: rec.evidence_type })).data,
    onSuccess: () => { setErr(''); refresh(); },
    onError: (e) => setErr(detailOf(e, 'The draft could not be started. Try again.')),
  });
  // Saved through Governance's own create endpoint, so its audit trail and workflows run as usual.
  const save = useMutation({
    mutationFn: async () => {
      const doc = (await apiClient.post('/governance/documents', {
        title: draft?.title || rec.evidence_type, content: draft?.content || '',
        doc_type: GOVERNANCE_TYPE[rec.document as DocKind] || 'guideline',
        description: `Drafted with AI for ${[context, itemNumber].filter(Boolean).join(' ') || 'an assessment item'}.`,
        tags: ['ai-draft'],
      })).data as { id: number };
      await apiClient.patch(`${base(assessmentId, itemId)}/ai-drafts/${key}`, { document_id: doc.id });
      return doc.id;
    },
    onSuccess: () => { setErr(''); refresh(); },
    onError: (e) => setErr(detailOf(e, 'Could not save it to Governance documents.')),
  });
  const get = async (fmt: 'docx' | 'pdf') => {
    setBusy(fmt);
    try {
      await download(`${base(assessmentId, itemId)}/ai-drafts/${key}/export`, { fmt }, `${draft?.title || rec.evidence_type}.${fmt}`);
    } catch (e) {
      setErr(detailOf(e, 'The download failed. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const status = start.isPending ? 'drafting' : draft?.status;
  const btn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60';

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-violet-600" />
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-slate-900">{rec.evidence_type}</span>
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-slate-500 ring-1 ring-slate-200">{rec.document}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">Structured on {basis}, written for this requirement.</p>

      {status === 'drafting' && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
          Drafting… this takes up to a minute. You can close this and come back.
        </p>
      )}
      {status === 'ready' && draft?.template && (
        <p className="mt-1 text-[11px] text-violet-700">Follows NIST&apos;s {draft.template}.</p>
      )}
      {status === 'failed' && draft?.error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{draft.error}</p>}
      {err && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{err}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(!status || status === 'failed') && (
          <button type="button" onClick={() => start.mutate()} disabled={start.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
            <Sparkles className="h-3 w-3" /> {status === 'failed' ? 'Try again' : 'Draft with AI'}
          </button>
        )}
        {status === 'ready' && (
          <>
            <button type="button" onClick={() => setPreview((p) => !p)} className={btn}>
              {preview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {preview ? 'Hide' : 'Preview'}
            </button>
            <button type="button" onClick={() => get('docx')} disabled={!!busy} className={btn}>
              {busy === 'docx' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Word
            </button>
            <button type="button" onClick={() => get('pdf')} disabled={!!busy} className={btn}>
              {busy === 'pdf' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} PDF
            </button>
            {draft?.document_id ? (
              <Link href={`/governance/documents/${draft.document_id}`} className={btn}>
                <FolderOpen className="h-3 w-3" /> Open in Governance
              </Link>
            ) : GOVERNANCE_TYPE[rec.document as DocKind] && (
              <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className={btn}>
                {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />} Save to Governance documents
              </button>
            )}
            <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className={btn} title="Draft it again">
              <RefreshCw className="h-3 w-3" /> Redraft
            </button>
          </>
        )}
      </div>

      {status === 'ready' && preview && draft?.content && (
        <div className="mt-2 max-h-[45vh] overflow-y-auto rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-slate-700 [&_h1]:mb-2 [&_h1]:text-[15px] [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-[13.5px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_table]:my-2 [&_table]:w-full [&_td]:border [&_td]:border-slate-200 [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:text-left [&_ul]:list-disc">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export function AiEvidenceDialog({ assessmentId, item, context, onClose, onLinked }: {
  assessmentId: number;
  item: Item;
  /** The assessment's name, shown above the requirement. */
  context?: string;
  onClose: () => void;
  /** After a library record is linked: the tab refreshes its evidence (and status, where linking passes the item). */
  onLinked?: () => void;
}) {
  const itemId = item.id;
  const [linked, setLinked] = useState<Set<number>>(new Set());
  const [linkError, setLinkError] = useState('');
  const asked = useRef(false);

  const saved = useQuery({
    queryKey: recKey(assessmentId, itemId),
    queryFn: () => fetchSaved(assessmentId, itemId),
    staleTime: 60_000,
    // Poll while a document is being drafted in the background.
    refetchInterval: (q) => (Object.values((q.state.data as Saved | undefined)?.recommendation?.drafts || {})
      .some((d) => d?.status === 'drafting') ? 3000 : false),
  });
  const run = useRun(assessmentId, itemId);
  const inFlight = useIsMutating({ mutationKey: runKey(assessmentId, itemId) }) > 0;
  const running = run.isPending || inFlight;
  const library = useNistLibrary();
  const templatesOf = (id: string) => library.data?.publications.find((p) => p.id === id)?.templates || [];
  const link = useMutation({
    mutationFn: async (evidenceId: number) =>
      (await apiClient.post(`${base(assessmentId, itemId)}/evidence/link`, { evidence_id: evidenceId })).data,
    onSuccess: (_data, evidenceId) => { setLinkError(''); setLinked((s) => new Set(s).add(evidenceId)); onLinked?.(); },
    onError: (e) => setLinkError(detailOf(e, 'Could not link that evidence.')),
  });

  const result = saved.data?.recommendation || null;
  const has = hasResult(result);
  // Ask straight away when nothing was recommended for this item yet (or a run is already going).
  useEffect(() => {
    if (!asked.current && saved.isSuccess && !has && !running) {
      asked.current = true;
      run.mutate();
    }
  }, [saved.isSuccess, has, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const runError = run.isError ? detailOf(run.error, 'AI evidence recommendations could not be generated.') : '';
  const matches = (result?.matches || []).filter((m) => !linked.has(m.evidence_id));
  const docs = (result?.recommendations || []).filter((r) => r.document);
  const nist = result?.nist || [];
  const references = result?.references || [];
  const basis = nist.length
    ? nist.map((n) => n.title.replace(/^NIST /, '').split(',')[0] + (n.refs ? ` (${n.refs})` : '')).join(', ')
    : 'NIST SP 800-53 Rev. 5';
  const loading = saved.isLoading || (running && !has);

  const header = (
    <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-3.5">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-slate-500">
          AI evidence recommendations{[context, item.item_number].filter(Boolean).length ? ` · ${[context, item.item_number].filter(Boolean).join(' · ')}` : ''}
        </p>
        <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-slate-900">{item.control_description}</p>
      </div>
      {when(saved.data?.generated_at) && !running && (
        <span className="hidden shrink-0 pt-1 text-[10px] text-slate-400 sm:inline">{when(saved.data?.generated_at)}</span>
      )}
      <button type="button" onClick={() => run.mutate()} disabled={running || saved.isLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : has ? <RefreshCw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
        {running ? 'Working…' : has ? 'Regenerate' : 'Get recommendations'}
      </button>
      <button type="button" onClick={onClose} aria-label="Close"
              className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <AnimatedModal isOpen onClose={onClose} size="3xl" bareHeader>
      {header}
      <div className="grid md:grid-cols-2 md:divide-x md:divide-slate-100">
        {/* Left: what proves the requirement */}
        <div className="space-y-3 px-5 py-4">
          <SectionTitle icon={Sparkles}>What proves this requirement</SectionTitle>
          {runError && (
            <div className="flex flex-wrap items-center gap-2 rounded bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-700">
              <span className="min-w-0 flex-1">{runError}</span>
              <button type="button" onClick={() => run.mutate()} className="font-semibold underline">Try again</button>
            </div>
          )}
          {loading ? (
            <><Progress /><Skeleton /></>
          ) : !has ? (
            !runError && <p className="text-[12px] text-slate-500">Ask the AI which evidence proves this item, how to collect it, and which records you already have that fit.</p>
          ) : (
            <>
              {result?.summary && <p className="text-[12.5px] text-slate-700">{result.summary}</p>}
              <ol className="space-y-2">
                {(result?.recommendations || []).map((rec, i) => (
                  <li key={i} className="rounded-md border border-slate-200 p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold text-slate-900">{i + 1}. {rec.evidence_type}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ring-1 ${PRIORITY[rec.priority] || PRIORITY.medium}`}>{rec.priority}</span>
                      {rec.document && (
                        <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-violet-700 ring-1 ring-violet-200">
                          {rec.document} · draft on the right
                        </span>
                      )}
                    </div>
                    {rec.description && <p className="mt-0.5 text-[11.5px] text-slate-600">{rec.description}</p>}
                    {rec.how_to_collect && (
                      <p className="mt-1 text-[11.5px] text-slate-600"><span className="font-semibold text-slate-700">How to collect: </span>{rec.how_to_collect}</p>
                    )}
                    {(rec.example_files || []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(rec.example_files || []).map((f) => (
                          <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{f}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>

              {(matches.length > 0 || linked.size > 0) && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2">
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">Already in your evidence library</p>
                  {linkError && <p className="mb-1 text-[11px] text-red-700">{linkError}</p>}
                  <ul className="space-y-1.5">
                    {matches.map((m) => (
                      <li key={m.evidence_id} className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium text-slate-800" title={m.file_name || m.name}>
                            {m.name}
                            {m.confidence != null && <span className="ml-1.5 text-[10px] font-normal text-slate-400">{Math.round(m.confidence * 100)}% fit</span>}
                          </p>
                          {m.reason && <p className="text-[11px] text-slate-500">{m.reason}</p>}
                        </div>
                        <button type="button" onClick={() => link.mutate(m.evidence_id)}
                                disabled={link.isPending && link.variables === m.evidence_id}
                                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                          {link.isPending && link.variables === m.evidence_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Link
                        </button>
                      </li>
                    ))}
                  </ul>
                  {linked.size > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700">
                      <Check className="h-3 w-3" /> {linked.size} record{linked.size === 1 ? '' : 's'} linked to this item.
                    </p>
                  )}
                </div>
              )}
              <p className="text-[10px] text-slate-400">
                AI suggestions: check each one fits before relying on it.
                {result?.library_checked != null && ` ${result.library_checked} library record${result.library_checked === 1 ? '' : 's'} checked.`}
              </p>
            </>
          )}
        </div>

        {/* Right: documents */}
        <div className="space-y-4 border-t border-slate-100 px-5 py-4 md:border-t-0">
          <div>
            <SectionTitle icon={FileText}>Draft a document</SectionTitle>
            {loading ? <Skeleton rows={1} /> : docs.length === 0 ? (
              <p className="text-[12px] text-slate-500">{has ? 'None of these recommendations is a document to write.' : 'Documents to draft appear here with the recommendations.'}</p>
            ) : (
              <div className="space-y-2">
                {docs.map((rec) => (
                  <DraftCard key={rec.evidence_type} assessmentId={assessmentId} itemId={itemId} rec={rec}
                             draft={result?.drafts?.[draftKey(rec.evidence_type)]} basis={basis}
                             context={context} itemNumber={item.item_number} />
                ))}
              </div>
            )}
          </div>

          <div>
            <SectionTitle icon={Library}>From your artifacts catalog</SectionTitle>
            {loading ? <Skeleton rows={1} /> : references.length === 0 ? (
              <p className="text-[12px] text-slate-500">{has ? 'No catalog document fits this requirement.' : 'Matching catalog documents appear here.'}</p>
            ) : (
              <ul className="divide-y divide-slate-100 border-y border-slate-100">
                {references.map((ref) => <ReferenceRow key={ref.artifact_id} reference={ref} />)}
              </ul>
            )}
          </div>

          <div>
            <SectionTitle icon={BookOpen}>NIST sources</SectionTitle>
            {loading ? <Skeleton rows={1} /> : nist.length === 0 ? (
              <p className="text-[12px] text-slate-500">{has ? 'Regenerate to see the NIST publications that apply.' : 'The NIST publications that apply appear here.'}</p>
            ) : (
              <ul className="space-y-1.5">
                {nist.map((n) => (
                  <li key={n.id} className="text-[12px]">
                    <a href={n.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-violet-700 hover:underline">
                      {n.title} <ExternalLink className="h-3 w-3" />
                    </a>
                    {(n.refs || n.why) && <p className="text-[11px] text-slate-500">{[n.refs, n.why].filter(Boolean).join(' — ')}</p>}
                    {templatesOf(n.id).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {templatesOf(n.id).map((t) => <TemplateLink key={t.url} template={t} />)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-slate-400">NIST publications are public domain in the US; drafts credit NIST as their source.</p>
          </div>
        </div>
      </div>
    </AnimatedModal>
  );
}

/** A document from the artifacts catalog, downloadable as Word or PDF. */
export function ReferenceRow({ reference }: { reference: Reference }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const get = async (fmt: 'docx' | 'pdf') => {
    setBusy(fmt);
    try {
      await download('/artifacts/catalog/export',
        { artifact_id: reference.artifact_id, framework_key: reference.framework_key, fmt }, `${reference.title}.${fmt}`);
      setErr('');
    } catch (e) {
      setErr(detailOf(e, 'The download failed. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const btn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60';
  return (
    <li className="py-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-slate-800">
            {reference.title}
            <span className="font-normal text-slate-400"> · {reference.framework}{reference.control_ref ? ` ${reference.control_ref}` : ''}</span>
          </p>
          {reference.reason && <p className="text-[11px] text-slate-500">{reference.reason}</p>}
          {err && <p className="text-[11px] text-red-700">{err}</p>}
        </div>
        <button type="button" onClick={() => get('docx')} disabled={!!busy} className={btn}>
          {busy === 'docx' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Word
        </button>
        <button type="button" onClick={() => get('pdf')} disabled={!!busy} className={btn}>
          {busy === 'pdf' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} PDF
        </button>
      </div>
    </li>
  );
}
