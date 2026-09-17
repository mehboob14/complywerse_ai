'use client';

// A control's evidence, laid out the way the Frameworks page lays out a
// requirement's: linked files on the left, required evidence on the right with
// an upload on every row. The required rows are the in-scope frameworks' own
// asks, so a PCI DSS tenant sees what PCI DSS asks for and nothing else. A file
// uploaded or picked from the library against a row is linked as that artifact,
// and the row's state follows it: needs evidence → pending review → satisfied.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, CircleDashed, Clock, Eye, FileCheck, Link2, Loader2, Paperclip, Radio, Sparkles, Unlink, Upload, XCircle,
} from 'lucide-react';
import { automationApi } from '@/lib/api';
import type { ArtifactState, AssuranceArtifact, AssuranceEvidence, AssurancePayload, Suggestion } from './types';

export const ARTIFACT_STATE: Record<ArtifactState, { label: string; cls: string; icon: JSX.Element }> = {
  failing: { label: 'Failing', cls: 'border-rose-200 bg-rose-50 text-rose-700', icon: <XCircle className="h-3 w-3" /> },
  missing: { label: 'Needs evidence', cls: 'border-amber-200 bg-amber-50 text-amber-800', icon: <CircleDashed className="h-3 w-3" /> },
  stale: { label: 'Expired', cls: 'border-orange-200 bg-orange-50 text-orange-700', icon: <Clock className="h-3 w-3" /> },
  pending_review: { label: 'Pending review', cls: 'border-sky-200 bg-sky-50 text-sky-700', icon: <Clock className="h-3 w-3" /> },
  satisfied: { label: 'Satisfied', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: <CheckCircle2 className="h-3 w-3" /> },
};

// The Frameworks page's evidence-type tones: categorical types stay neutral,
// policy is the single accent, certificate and contract keep a semantic tone.
const TYPE_TONE: Record<string, string> = {
  policy: 'bg-primary-50 text-primary-700',
  certificate: 'bg-emerald-50 text-emerald-700',
  contract: 'bg-amber-50 text-amber-700',
};
const typeTone = (t?: string) => TYPE_TONE[t || ''] || 'bg-slate-100 text-slate-600';
const typeLabel = (t?: string) => (t || 'document').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const fileLabel = (ft?: string | null) => {
  const raw = (ft || '').toLowerCase().replace(/^\./, '');
  if (!raw) return null;
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(raw) ? 'Document' : raw.toUpperCase();
};

const EVIDENCE_STATUS: Record<AssuranceEvidence['state'], { label: string; cls: string }> = {
  approved: { label: 'approved', cls: 'bg-emerald-50 text-emerald-700' },
  pending: { label: 'pending', cls: 'bg-amber-50 text-amber-700' },
  stale: { label: 'expired', cls: 'bg-orange-50 text-orange-700' },
  rejected: { label: 'rejected', cls: 'bg-rose-50 text-rose-700' },
};

const ORDER: ArtifactState[] = ['failing', 'missing', 'stale', 'pending_review', 'satisfied'];

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : (e as Error)?.message || fallback;
}

function UploadButton({ busy, onFile, label = 'Upload' }: { busy: boolean; onFile: (f: File) => void; label?: string }) {
  return (
    <label className={`inline-flex flex-shrink-0 items-center ${busy ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
      <input type="file" className="hidden" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <span className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-primary-700">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {label}
      </span>
    </label>
  );
}

export default function EvidenceWorkspace({ code }: { code: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const q = useQuery({
    queryKey: ['control-assurance', code],
    queryFn: () => automationApi.getControlAssurance(code).then((r) => r.data as AssurancePayload),
  });
  const suggestionsQ = useQuery({
    queryKey: ['control-assurance-suggestions', code],
    queryFn: () => automationApi.getAssuranceSuggestions(code)
      .then((r) => r.data as { suggestions: Record<string, Suggestion[]> }),
    staleTime: 60_000,
  });

  const artifacts = useMemo(
    () => [...(q.data?.artifacts ?? [])].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state)),
    [q.data?.artifacts],
  );
  const names = useMemo(() => new Map(artifacts.map((a) => [a.key, a.name])), [artifacts]);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['control-assurance', code] }),
    qc.invalidateQueries({ queryKey: ['control-assurance-suggestions', code] }),
    qc.invalidateQueries({ queryKey: ['control-evidence', code] }),
  ]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    try {
      await fn();
      await refresh();
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'err', text: errorText(e, 'That did not work.') });
    } finally { setBusy(null); }
  };

  const upload = (file: File, artifact?: AssuranceArtifact) => act(
    `upload-${artifact?.key ?? 'control'}`,
    async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('name', artifact ? `${artifact.name} — ${file.name}` : file.name);
      form.append('source_system', `Control ${code}`);
      const body = (await automationApi.uploadEvidenceItem(form)).data as { id?: number; evidence_id?: number };
      const id = body.id ?? body.evidence_id;
      if (!id) throw new Error('Upload returned no evidence id');
      await automationApi.linkAssuranceEvidence(code, { evidence_id: id, artifact_name: artifact?.name ?? null });
    },
    artifact ? `Uploaded and linked as ${artifact.name}. It stays pending until someone reviews it.` : 'Uploaded and linked to this control.',
  );

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading evidence…</div>;
  }
  if (q.isError || !q.data) {
    return <p className="text-sm text-rose-700">Could not load this control&apos;s evidence.</p>;
  }
  const linked = q.data.evidence;
  const suggestions = suggestionsQ.data?.suggestions ?? {};

  return (
    <div className="space-y-3">
      {msg && <p className={`text-xs ${msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Linked evidence */}
        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Paperclip className="h-4 w-4 text-primary-700" />
              Linked Evidence ({linked.length})
            </h4>
            <UploadButton busy={busy === 'upload-control'} onFile={(f) => upload(f)} />
          </div>
          {linked.length ? (
            <div className="space-y-2">
              {linked.map((ev) => {
                const status = EVIDENCE_STATUS[ev.state] || EVIDENCE_STATUS.pending;
                const artifactName = (ev.artifact_key && names.get(ev.artifact_key)) || ev.clause_reference;
                return (
                  <div key={ev.mapping_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center gap-3">
                      <Paperclip className="h-4 w-4 flex-shrink-0 text-slate-600" />
                      <Link href={`/evidence/${ev.evidence_id}`} className="group min-w-0 flex-1" title="Open evidence detail">
                        <p className="truncate text-sm text-slate-900 group-hover:text-primary-700 group-hover:underline">{ev.file_name || ev.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {ev.uploaded_at ? new Date(ev.uploaded_at).toLocaleDateString() : ''}
                          {artifactName ? `${ev.uploaded_at ? ' · ' : ''}${artifactName}` : ''}
                          {ev.expiry_date ? ` · expires ${new Date(ev.expiry_date).toLocaleDateString()}` : ''}
                        </p>
                      </Link>
                      <span className={`flex-shrink-0 rounded px-2 py-0.5 text-xs ${status.cls}`}>{status.label}</span>
                    </div>
                    <div className="ml-7 mt-3 flex flex-wrap items-center gap-2">
                      <Link href={`/evidence/${ev.evidence_id}`}
                        className="flex items-center gap-1 rounded bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100">
                        <Eye className="h-3 w-3" /> Open
                      </Link>
                      {!ev.locked && (
                        <button type="button" disabled={!!busy}
                          onClick={() => window.confirm('Unlink this evidence from the control? It stays in your evidence library.')
                            && act(`unlink-${ev.mapping_id}`, () => automationApi.unlinkAssuranceEvidence(code, ev.mapping_id), `Unlinked “${ev.name}”.`)}
                          className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                          {busy === `unlink-${ev.mapping_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                          Unlink
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
              <Paperclip className="mx-auto mb-2 h-8 w-8 text-slate-400" />
              <p className="text-sm text-slate-900">No evidence linked yet</p>
              <p className="mt-1 text-xs text-slate-600">Upload evidence to comply</p>
            </div>
          )}
        </div>

        {/* Required evidence */}
        <div className="min-w-0">
          <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileCheck className="h-4 w-4 text-primary-700" />
            Required Evidence for {code}
          </h4>
          {artifacts.length ? (
            <div className="space-y-2">
              {artifacts.map((a) => (
                <RequiredRow key={a.key} artifact={a} suggestions={suggestions[a.key] ?? []}
                  busy={busy} onUpload={(f) => upload(f, a)}
                  onUse={(s) => act(`use-${a.key}-${s.evidence_id}`,
                    () => automationApi.linkAssuranceEvidence(code, { evidence_id: s.evidence_id, artifact_name: a.name }),
                    `Linked “${s.name}” as ${a.name}.`)} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center">
              <p className="text-sm text-slate-900">No evidence requirements defined</p>
              <p className="mt-1 text-xs text-slate-600">Your in-scope frameworks name no specific evidence for this control.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RequiredRow({
  artifact: a, suggestions, busy, onUpload, onUse,
}: {
  artifact: AssuranceArtifact;
  suggestions: Suggestion[];
  busy: string | null;
  onUpload: (f: File) => void;
  onUse: (s: Suggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const st = ARTIFACT_STATE[a.state];
  const tone = typeTone(a.type);
  const file = fileLabel(a.filetype);
  const desc = (a.description || '').trim();
  const offer = a.state !== 'satisfied' ? suggestions : [];

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-1.5 transition-colors hover:bg-slate-50/60">
      <div className="flex items-center gap-3">
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${tone}`}>
          <Radio className="h-3.5 w-3.5" />
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <p className="truncate text-sm font-medium leading-tight text-slate-900">{a.name}</p>
          {desc && desc.toLowerCase() !== a.name.toLowerCase() && (
            <p className={`mt-0.5 text-[11px] text-slate-500 ${open ? '' : 'line-clamp-1'}`}>{desc}</p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>{typeLabel(a.type)}</span>
            {file && <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{file}</span>}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${a.mandatory ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
              {a.mandatory ? 'Required' : 'Optional'}
            </span>
            {a.collection_method !== 'manual' && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700"
                title="A connected check's passing result can stand for this">
                {a.collection_method === 'automated' ? 'Collector' : 'Hybrid'}
              </span>
            )}
            {(a.references?.length ? a.references : a.required_by).length > 0 && (
              <span className="truncate text-[10px] text-slate-400">{(a.references?.length ? a.references : a.required_by).join(', ')}</span>
            )}
          </div>
        </button>
        <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
          {st.icon}{st.label}
        </span>
        <UploadButton busy={busy === `upload-${a.key}`} onFile={onUpload} />
      </div>

      {offer.length > 0 && (
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="ml-10 mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-800">
          <Sparkles className="h-3 w-3" /> {offer.length} match{offer.length === 1 ? '' : 'es'} in your evidence library
        </button>
      )}

      {open && (a.evidence.length > 0 || offer.length > 0) && (
        <div className="ml-10 mt-2 space-y-2 border-t border-slate-100 pb-1.5 pt-2">
          {a.evidence.map((ev) => (
            <p key={ev.mapping_id} className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <Paperclip className="h-3 w-3 text-slate-400" />
              <Link href={`/evidence/${ev.evidence_id}`} className="truncate hover:text-primary-700">{ev.name}</Link>
              <span className="text-slate-400">· {EVIDENCE_STATUS[ev.state]?.label ?? ev.state}</span>
            </p>
          ))}
          {offer.map((s) => (
            <div key={s.evidence_id} className="flex items-start gap-2 rounded-md border border-primary-100 bg-primary-50/40 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <Link href={`/evidence/${s.evidence_id}`} className="block truncate text-[12px] font-medium text-slate-800 hover:text-primary-700">{s.name}</Link>
                <span className="block text-[11px] leading-snug text-slate-500">{s.reasons.join(' · ')}</span>
              </span>
              <button type="button" disabled={!!busy} onClick={() => onUse(s)}
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {busy === `use-${a.key}-${s.evidence_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                Use this
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
