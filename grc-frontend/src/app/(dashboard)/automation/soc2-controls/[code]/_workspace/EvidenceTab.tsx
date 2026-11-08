'use client';

// The Evidence tab: what the control's frameworks ask to be kept (Required evidence, each row with an upload and the matches in the library), what is linked (Linked files), what the
// connected sources collected by themselves (Collected automatically) and the documents the frameworks expect the organisation to write (Documents to produce). One place for evidence; the
// old page had three doors to it. A file uploaded against a row is linked as that artifact and the row follows it: needs evidence -> pending review -> satisfied.
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Link2, Unlink, Upload } from 'lucide-react';
import { Button, EmptyState, IconButton, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { automationApi } from '@/lib/api';
import { formatDate, statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { checkResult, evidenceFile, evidenceNeed } from '@/lib/statuses/controls';
import { DocumentsSection } from './DocumentsSection';
import { Loaded, Small } from './parts';
import { SectionStack } from './SectionStack';
import type { ArtifactState, AssuranceArtifact, AssuranceEvidence, AssurancePayload, AutomatedResult } from './types';
import { resultWord } from './WrittenTest';
import { useAssurance, useSuggestions } from './workspaceData';
import { useWorkspace } from './workspaceContext';

const ORDER: ArtifactState[] = ['failing', 'missing', 'stale', 'pending_review', 'satisfied'];
const typeLabel = (t?: string) => statusLabel(t || 'document');
const fileLabel = (ft?: string | null) => {
  const raw = (ft || '').toLowerCase().replace(/^\./, '');
  if (!raw) return null;
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(raw) ? 'Document' : raw.toUpperCase();
};

/** Upload a file and link it to the control (as a required artifact, or generally). The file lands in the Evidence Library first; when the link then fails the words say so. */
function useUploadAndLink() {
  const { code, refresh } = useWorkspace();
  return useReportedMutation({
    mutationFn: async (v: { file: File; artifact?: AssuranceArtifact }) => {
      const form = new FormData();
      form.append('file', v.file);
      form.append('name', v.artifact ? `${v.artifact.name} — ${v.file.name}` : v.file.name);
      form.append('source_system', `Control ${code}`);
      const body = (await automationApi.uploadEvidenceItem(form)).data as { id?: number; evidence_id?: number };
      const id = body.id ?? body.evidence_id;
      if (!id) throw new Error('The upload did not finish. Try again.');
      try {
        await automationApi.linkAssuranceEvidence(code, { evidence_id: id, artifact_name: v.artifact?.name ?? null });
      } catch (e) {
        throw new Error(`The file is in the Evidence Library, but it could not be linked to this control: ${errorMessage(e)} Link it from the Evidence Library.`);
      }
      return v.artifact;
    },
    success: (artifact) => ({ title: 'Evidence added', message: artifact ? `Linked as ${artifact.name}. It stays pending until someone reviews it.` : 'Linked to this control.' }),
    failure: "Couldn't add the evidence",
    onSuccess: () => { void refresh(); },
  });
}

function UploadButton({ label, disabled, reason, busy, onFile, variant = 'secondary' }: { label: string; disabled: boolean; reason?: string; busy: boolean; onFile: (f: File) => void; variant?: 'primary' | 'secondary' }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" variant={variant} leftIcon={<Upload aria-hidden />} loading={busy} disabled={disabled} title={reason} onClick={() => input.current?.click()}>{label}</Button>
      <input ref={input} type="file" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </>
  );
}

function RequiredRow({ a, offered, onUpload, uploading }: { a: AssuranceArtifact; offered: Array<{ evidence_id: number; reasons: string[]; name: string }>; onUpload: (f: File) => void; uploading: boolean }) {
  const { code, rights, why, refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  const use = useReportedMutation({
    mutationFn: (s: { evidence_id: number; name: string }) => automationApi.linkAssuranceEvidence(code, { evidence_id: s.evidence_id, artifact_name: a.name }),
    success: (_d, s) => `Linked “${s.name}” as ${a.name}`, failure: "Couldn't link the evidence", onSuccess: () => { void refresh(); },
  });
  const desc = (a.description || '').trim();
  const file = fileLabel(a.filetype);
  const refs = (a.references?.length ? a.references : a.required_by).join(', ');
  const matches = a.state !== 'satisfied' ? offered : [];
  return (
    <li className="px-[12px] py-[10px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-w-0 flex-1 basis-[14rem] rounded-ds-control text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
          <span className="block text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{a.name}</span>
          <span className="mt-[2px] flex flex-wrap items-center gap-[6px] text-ds-label text-ds-fg-muted">
            <span>{typeLabel(a.type)}</span>{file && file !== typeLabel(a.type) && <span>· {file}</span>}<span>· {a.mandatory ? 'Required' : 'Optional'}</span>
            {a.collection_method !== 'manual' && <span title="A connected test's passing result can stand for this">· {a.collection_method === 'automated' ? 'From a source' : 'Partly from a source'}</span>}
            {refs && <span className="[overflow-wrap:anywhere]">· {refs}</span>}
          </span>
        </button>
        <StatusPill {...statusPill(evidenceNeed, a.state)} />
        <UploadButton label="Upload" disabled={!rights.evidence} reason={why('evidence')} busy={uploading} onFile={onUpload} />
      </div>
      {matches.length > 0 && <Button variant="link" size="sm" className="-ml-[8px] mt-[2px]" onClick={() => setOpen(true)}>{`${matches.length} ${matches.length === 1 ? 'match' : 'matches'} in your evidence library`}</Button>}
      {open && (
        <div className="mt-[8px] flex flex-col gap-[8px] border-t border-ds-border pt-[8px]">
          {desc && desc.toLowerCase() !== a.name.toLowerCase() && <p className="text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{desc}</p>}
          {a.evidence.map((ev) => (
            <p key={ev.mapping_id} className="flex flex-wrap items-center gap-[6px] text-ds-body text-ds-fg-body"><Link href={`/evidence/${ev.evidence_id}`} className="truncate font-medium text-ds-primary-text hover:underline">{ev.name}</Link><StatusPill size="sm" {...statusPill(evidenceFile, ev.state)} /></p>
          ))}
          {matches.map((s) => (
            <div key={s.evidence_id} className="flex flex-wrap items-center gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[10px] py-[6px]">
              <div className="min-w-0 flex-1 basis-[12rem]">
                <Link href={`/evidence/${s.evidence_id}`} className="block truncate text-ds-body font-[500] text-ds-primary-text hover:underline">{s.name}</Link>
                <Small>{s.reasons.join(' · ')}</Small>
              </div>
              <Button size="sm" variant="primary" leftIcon={<Link2 aria-hidden />} loading={use.isPending && use.variables?.evidence_id === s.evidence_id} disabled={!rights.evidence} title={why('evidence')} onClick={() => use.mutate({ evidence_id: s.evidence_id, name: s.name })}>Use this</Button>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function RequiredSection() {
  const { code } = useWorkspace();
  const q = useAssurance(code);
  const sug = useSuggestions(code);
  const up = useUploadAndLink();
  return (
    <Loaded q={q} what="the required evidence" rows={3}>
      {(a) => {
        const arts = [...a.artifacts].sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state));
        if (!arts.length) return <EmptyState kind="firstUse" bare title="No evidence is required" description="None of your in-scope frameworks names specific evidence for this control. Attach anything that shows it operating under Linked files." />;
        return (
          <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
            {sug.isError && <li className="px-[12px] py-[6px] text-ds-label text-ds-fg-muted">The matches in your evidence library could not be loaded.</li>}
            {arts.map((art) => <RequiredRow key={art.key} a={art} offered={sug.data?.suggestions[art.key] ?? []} uploading={up.isPending && up.variables?.artifact?.key === art.key} onUpload={(file) => up.mutate({ file, artifact: art })} />)}
          </ul>
        );
      }}
    </Loaded>
  );
}

function LinkedSection() {
  const { code, rights, why, refresh } = useWorkspace();
  const q = useAssurance(code);
  const up = useUploadAndLink();
  const { confirm, confirmDialog } = useConfirm();
  const unlink = useReportedMutation({
    mutationFn: (ev: AssuranceEvidence) => automationApi.unlinkAssuranceEvidence(code, ev.mapping_id),
    success: (_d, ev) => `Unlinked “${ev.name}”`, failure: "Couldn't unlink the evidence", onSuccess: () => { void refresh(); },
  });
  const ask = async (ev: AssuranceEvidence) => {
    if (await confirm({ title: 'Unlink this evidence?', message: `“${ev.name}” stays in your evidence library; it is only taken off this control.`, confirmLabel: 'Unlink', tone: 'danger' })) unlink.mutate(ev);
  };
  return (
    <Loaded q={q} what="the linked files" rows={3}>
      {(a: AssurancePayload) => {
        const names = new Map(a.artifacts.map((x) => [x.key, x.name]));
        return (
          <div className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <UploadButton label="Upload a file" variant="primary" disabled={!rights.evidence} reason={why('evidence')} busy={up.isPending && !up.variables?.artifact} onFile={(file) => up.mutate({ file })} />
              <Small>{`${a.evidence.length} ${a.evidence.length === 1 ? 'file' : 'files'} linked`}</Small>
            </div>
            {a.evidence.length === 0 ? <EmptyState kind="firstUse" bare title="No evidence linked yet" description="Upload a file, or link one from the Evidence Library." /> : (
              <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                {a.evidence.map((ev) => {
                  const art = (ev.artifact_key && names.get(ev.artifact_key)) || ev.clause_reference;
                  return (
                    <li key={ev.mapping_id} className="flex flex-wrap items-center gap-[8px] px-[12px] py-[8px]">
                      <div className="min-w-0 flex-1 basis-[14rem]">
                        <Link href={`/evidence/${ev.evidence_id}`} className="block truncate text-ds-body font-[600] text-ds-primary-text hover:underline" title={ev.file_name || ev.name}>{ev.file_name || ev.name}</Link>
                        <Small>{[ev.uploaded_at ? formatDate(ev.uploaded_at) : null, art, ev.expiry_date ? `expires ${formatDate(ev.expiry_date, { calendar: true })}` : null].filter(Boolean).join(' · ')}</Small>
                      </div>
                      <StatusPill size="sm" {...statusPill(evidenceFile, ev.state)} />
                      {!ev.locked && <IconButton label={`Unlink ${ev.name}`} disabled={!rights.evidence} onClick={() => { void ask(ev); }}><Unlink aria-hidden strokeWidth={1.75} /></IconButton>}
                    </li>
                  );
                })}
              </ul>
            )}
            {confirmDialog}
          </div>
        );
      }}
    </Loaded>
  );
}

function CollectedSection() {
  const { code } = useWorkspace();
  const q = useAssurance(code);
  return (
    <Loaded q={q} what="the collected results" rows={3}>
      {(a) => {
        const results: AutomatedResult[] = a.automated.results;
        if (!results.length) return <EmptyState kind="firstUse" bare title="Nothing collected yet" description="Connected tests write their results here after each run." />;
        return (
          <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
            {results.map((r, i) => (
              <li key={`${r.check_id}-${r.ao_id}-${r.resource}-${i}`} className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] px-[12px] py-[8px]">
                <div className="min-w-0 flex-1 basis-[14rem]">
                  <p className="text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{statusLabel(r.check_id.split('.').slice(1).join(' ') || r.check_id)}</p>
                  <Small>{`${statusLabel(r.connector)}${r.population_size != null ? ` · ${r.tested_size ?? r.population_size} of ${r.population_size} checked${r.truncated ? ' (partial)' : ''}` : ''}${r.detail ? ` · ${r.detail}` : ''}`}</Small>
                </div>
                <StatusPill size="sm" {...statusPill(checkResult, r.expired ? 'expired' : resultWord(r.status))} />
                <Small>{`${r.collected_at ? `Collected ${formatDate(r.collected_at)}` : 'Not collected'}${r.expires_at ? ` · valid until ${formatDate(r.expires_at)}` : ''}`}</Small>
              </li>
            ))}
          </ul>
        );
      }}
    </Loaded>
  );
}

export function EvidenceTab() {
  const { code } = useWorkspace();
  const q = useAssurance(code);
  const r = q.data?.readiness;
  const docs = useQuery({ queryKey: ['control-artifacts', code], queryFn: async () => (await automationApi.listControlArtifacts(code)).data as { items: Array<{ artifact: unknown | null }> } });
  const items = docs.data?.items;
  return (
    <SectionStack
      label="Evidence"
      sections={[
        { key: 'required', meta: r ? (r.total ? `${r.satisfied} of ${r.total} satisfied` : 'None named by your frameworks') : q.isError ? 'Couldn’t be loaded' : 'Loading', children: <RequiredSection /> },
        { key: 'linked', meta: q.data ? `${q.data.evidence.length} ${q.data.evidence.length === 1 ? 'file' : 'files'}` : undefined, children: <LinkedSection /> },
        { key: 'collected', meta: q.data ? `${q.data.automated.results.length} ${q.data.automated.results.length === 1 ? 'result' : 'results'}` : undefined, children: <CollectedSection /> },
        { key: 'documents', meta: items ? (items.length ? `${items.filter((i) => i.artifact).length} of ${items.length} started` : 'None named by your frameworks') : docs.isError ? 'Couldn’t be loaded' : undefined, children: <DocumentsSection /> },
      ]}
    />
  );
}
