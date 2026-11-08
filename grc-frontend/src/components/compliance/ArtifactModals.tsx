'use client';

// The four pieces an artifact is read, started, edited and downloaded with: the viewer of a catalogue entry, the "start a working copy" form, the editor of
// a written copy, and the download menu. The Artifacts tab uses them (ArtifactsTab.tsx re-exports them under their old names), and so do the control's
// "Documents to produce" and the requirement popup, which is why their props did not change. Every failure is said in words (no alert box), a form with
// typed text asks before it is closed, and a document that could not be read says so instead of "not generated yet".
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Database, Download, ExternalLink, FileSpreadsheet, FileText, Plus, Upload } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';
import {
  Button, EmptyState, ErrorState, FormField, IconButton, Menu, Notice, SegmentedControl, Select, SkeletonLines, StatusPill, Textarea, TextInput, linkClasses, useNotify,
  type MenuItem,
} from '@/components/ui/ds';
import apiClient from '@/lib/api';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { UNASSIGNED, formatCount } from '@/lib/format';
import { artifactStatus } from '@/lib/statuses/frameworkRegisters';
import { buildArtifactTemplate, type ArtifactMeta } from './artifactTemplates';
import { downloadAsFormat } from './downloadUtils';
import {
  FORMAT_LABEL, dataTypeWords, formatsForArtifact, formatsForMode, liveExportName, mandatoryNote,
  type CatalogItem, type TenantArtifact, type TenantUser,
} from './artifactsModel';

// ─── downloads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fetch a file from the server and hand it to the browser to save. */
export async function downloadFromServer(url: string, params: Record<string, unknown>, fallbackName: string): Promise<void> {
  const res = await apiClient.get(url, { params, responseType: 'blob' });
  const cd = (res.headers?.['content-disposition'] as string) || '';
  const m = /filename="?([^"]+)"?/.exec(cd);
  const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}

function DownloadMenu({ formats, onPick, busy, label = 'Download', size = 'md' }: { formats: string[]; onPick: (fmt: string) => void; busy?: boolean; label?: string; size?: 'sm' | 'md' }) {
  const items: MenuItem[] = formats.map((f) => ({
    key: f,
    label: FORMAT_LABEL[f] || f,
    icon: f === 'xlsx' || f === 'csv' ? FileSpreadsheet : FileText,
    onSelect: () => onPick(f),
    disabled: busy,
  }));
  return label ? <Menu label={label} items={items} size={size} disabled={busy} /> : <Menu iconOnly label="Download as" items={items} size={size} disabled={busy} />;
}

/** Download a working copy. Platform-native artifacts (risk register, asset inventory ...) export live data as a spreadsheet on the server, because their
 *  content is live data, not the Markdown kept in `artifact.content`; everything else is rendered from its content in the formats that suit it. */
export function ArtifactDownload({ artifact, label = '' }: { artifact: TenantArtifact; label?: string }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const run = async (params: Record<string, unknown>, name: string) => {
    setBusy(true);
    try { await downloadFromServer(`/artifacts/${artifact.id}/export`, params, name); } catch (e) { notify.error(e, { title: "Couldn't download the file", fallback: 'The file could not be made. Try again.' }); } finally { setBusy(false); }
  };
  if (artifact.is_platform_native) {
    return <IconButton label="Download the live data as a spreadsheet" disabled={busy} onClick={() => { void run({}, liveExportName(artifact.name)); }}><Download /></IconButton>;
  }
  if (!artifact.content) return null;
  return <DownloadMenu label={label} size="sm" busy={busy} formats={formatsForArtifact(artifact.format)} onPick={(fmt) => { void run({ fmt }, `${artifact.name}.${fmt}`); }} />;
}

// ─── live platform data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface PlatformData { total: number; items: Array<{ id: number; title?: string; name?: string }> }

function PlatformDataPanel({ dataType }: { dataType: string }) {
  const risks = dataType === 'risk_register';
  const label = risks ? 'risk register' : 'asset inventory';
  const q = useQuery<PlatformData>({
    queryKey: ['artifact-platform-data', dataType],
    queryFn: async () => (await apiClient.get(risks ? '/artifacts/platform-data/risk-register' : '/artifacts/platform-data/asset-inventory')).data,
    staleTime: 30_000,
  });
  if (q.isLoading) return <SkeletonLines lines={3} />;
  if (q.error) return <Notice tone="warning" title={`The live ${label} didn't load`}>{safeDetail(apiErrorText(q.error, 'Please try again.'))}</Notice>;
  const total = q.data?.total ?? 0;
  const shown = (q.data?.items ?? []).slice(0, 10);
  return (
    <section aria-label={`Live ${label}`} className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="inline-flex items-center gap-[6px] text-ds-body font-medium text-ds-fg"><Database aria-hidden className="h-[16px] w-[16px]" />{`Live ${label}`}</p>
        <Link href={risks ? '/erm/risks' : '/assets'} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-[4px] ${linkClasses({ tone: 'text', size: 'label' })}`}>Open<ExternalLink aria-hidden className="h-[12px] w-[12px]" /></Link>
      </div>
      <p className="mt-[4px] text-ds-body text-ds-fg-body">{`${formatCount(total)} ${total === 1 ? 'record' : 'records'} in your ${label}.`}</p>
      {shown.length > 0 && (
        <ul className="mt-[8px] max-h-[128px] space-y-[4px] overflow-y-auto">
          {shown.map((it) => <li key={it.id} className="truncate rounded-ds-control border border-ds-border bg-ds-surface px-[8px] py-[2px] text-ds-label text-ds-fg-body">{it.title || it.name || 'Untitled record'}</li>)}
        </ul>
      )}
      {total > shown.length && <p className="mt-[4px] text-ds-label text-ds-fg-muted">{`+${formatCount(total - shown.length)} more`}</p>}
    </section>
  );
}

// ─── the content box (written text, edit or preview) ──────────────────────────────────────────────────────────────────────────────────────────

function ContentBox({ label, hint, content, onChange, extra }: { label: string; hint?: string; content: string; onChange: (text: string) => void; extra?: React.ReactNode }) {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const file = useRef<HTMLInputElement>(null);
  const group = useId();
  const notify = useNotify();
  const read = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => { onChange(typeof ev.target?.result === 'string' ? ev.target.result : ''); setMode('edit'); };
    reader.onerror = () => notify.error("That file couldn't be read.", { title: "Couldn't use the file" });
    reader.readAsText(f);
  };
  return (
    <div>
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
        <p className="text-ds-label font-medium text-ds-fg">{label}{hint && <span className="ml-[6px] font-normal text-ds-fg-muted">{hint}</span>}</p>
        <div className="flex flex-wrap items-center gap-[8px]">
          <SegmentedControl label="Show the text as" name={`content-mode-${group}`} value={mode} onChange={setMode} options={[{ value: 'preview', label: 'Preview' }, { value: 'edit', label: 'Edit' }]} />
          {extra}
          <Button size="sm" leftIcon={<Upload aria-hidden />} onClick={() => file.current?.click()}>Use a file</Button>
          <input ref={file} type="file" accept=".md,.txt" className="hidden" onChange={read} aria-hidden tabIndex={-1} />
        </div>
      </div>
      {mode === 'preview' ? (
        <div className="max-h-[28rem] min-h-[12rem] overflow-y-auto rounded-ds-control border border-ds-border-control bg-ds-surface px-[16px] py-[12px]">
          {content.trim() ? <GovernanceDocumentMarkdown content={content} /> : <p className="text-ds-body text-ds-fg-muted">No text yet. Switch to Edit to write it.</p>}
        </div>
      ) : (
        <Textarea aria-label={label} rows={16} value={content} onChange={(e) => onChange(e.target.value)} placeholder="Write the document" className="[&_textarea]:font-mono [&_textarea]:text-ds-label" />
      )}
    </div>
  );
}

const people = (users: TenantUser[]) => users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>);

// ─── view ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface CatalogContent { found: boolean; title?: string; type?: string; control_ref?: string | null; content?: string | null; content_format?: string; format?: string | null }

const MODE_WORDS: Record<string, string> = { table: 'Spreadsheet template', guide: 'Collection guide', markdown: 'Document' };

/** Read the document, template or guide that was generated for a catalogue entry, and download it. */
export function ViewArtifactModal({ item, frameworkKey, onClose, onCreate }: { item: CatalogItem; frameworkKey: string; onClose: () => void; onCreate?: () => void }) {
  const notify = useNotify();
  const [downloading, setDownloading] = useState(false);
  const q = useQuery<CatalogContent>({
    queryKey: ['artifact-content', frameworkKey, item.artifact_id],
    queryFn: async () => (await apiClient.get('/artifacts/catalog/content', { params: { artifact_id: item.artifact_id, framework_key: frameworkKey } })).data,
    staleTime: 5 * 60_000,
  });
  const found = !!q.data?.found;
  const mode = q.data?.content_format || 'markdown';
  const download = async (fmt: string) => {
    setDownloading(true);
    try {
      await downloadFromServer('/artifacts/catalog/export', { artifact_id: item.artifact_id, framework_key: frameworkKey, fmt }, `${item.name}.${fmt}`);
    } catch (e) {
      notify.error(e, { title: "Couldn't download the file", fallback: 'Has this document been generated yet?' });
    } finally {
      setDownloading(false);
    }
  };
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      title={item.name}
      subtitle={[item.artifact_type, item.control_ref, item.format].filter(Boolean).join(' · ')}
      headerAccessory={found ? <StatusPill size="sm" tone="neutral" label={MODE_WORDS[mode] || MODE_WORDS.markdown} /> : undefined}
      size="xl"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          {found && <DownloadMenu formats={formatsForMode(mode)} onPick={(f) => { void download(f); }} busy={downloading} />}
          {found && onCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onCreate}>Create working copy</Button>}
          <Button onClick={onClose}>Close</Button>
        </div>
      )}
    >
      <div className="p-[20px]">
        {q.isLoading ? <SkeletonLines lines={8} />
          : q.error ? <ErrorState title="Couldn't read this document" message={safeDetail(apiErrorText(q.error, 'Please try again.'))} onRetry={() => { void q.refetch(); }} />
            : !found ? <EmptyState kind="firstUse" bare title="Not generated yet" description="This artifact has no starter document yet. You can still start a working copy from a blank page." />
              : <GovernanceDocumentMarkdown content={q.data?.content || ''} />}
      </div>
    </AnimatedModal>
  );
}

// ─── create ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Start a working copy of a catalogue entry: its name, description, owner and text (the generated starter document when there is one). */
export function CreateArtifactModal({ item, frameworkKey, frameworkName, assessmentId, tenantUsers, onConfirm, onClose, isPending }: {
  item: CatalogItem; frameworkKey: string; frameworkName: string; assessmentId?: number; tenantUsers: TenantUser[];
  onConfirm: (payload: Record<string, unknown>) => void; onClose: () => void; isPending: boolean;
}) {
  const meta: ArtifactMeta = {
    name: item.name, artifactType: item.artifact_type, controlRef: item.control_ref, description: item.description, frameworkName, frameworkKey,
    stage: item.stage, artifactId: item.artifact_id, owner: item.owner, format: item.format,
  };
  const initialTemplate = item.is_platform_native ? '' : buildArtifactTemplate(meta);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description || '');
  const [content, setContent] = useState(initialTemplate);
  const [assignedToId, setAssignedToId] = useState<number | null>(null);
  const typed = useRef(false);

  // Prefer the generated, type- and control-specific text over the generic template, but only while the person has not written anything.
  const { data: generated } = useQuery<CatalogContent>({
    queryKey: ['artifact-content', frameworkKey, item.artifact_id],
    queryFn: async () => (await apiClient.get('/artifacts/catalog/content', { params: { artifact_id: item.artifact_id, framework_key: frameworkKey } })).data,
    enabled: !item.is_platform_native,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (generated?.found && generated.content && !typed.current) setContent(generated.content);
  }, [generated]);

  const create = () => onConfirm({
    // A virtual catalogue entry (made from a requirement's evidence list) has a negative made-up id and no row of its own: it must not be sent as a key.
    ...(item.id > 0 ? { catalog_item_id: item.id } : {}),
    assessment_id: assessmentId,
    framework_key: frameworkKey,
    name,
    artifact_type: item.artifact_type,
    stage: item.stage,
    control_ref: item.control_ref,
    description,
    format: item.format,
    content: item.is_platform_native ? null : content,
    assigned_to_id: assignedToId,
    is_platform_native: item.is_platform_native,
    platform_data_type: item.platform_data_type,
  });

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      dirty={typed.current || name !== item.name || description !== (item.description || '') || assignedToId !== null}
      title="Start a working copy"
      subtitle={[item.stage, item.artifact_type, frameworkName].filter(Boolean).join(' · ')}
      size="xl"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <p className="text-ds-label text-ds-fg-muted">Read the text, switch to Edit to change it, then create the copy.</p>
          <div className="flex gap-[8px]">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" leftIcon={<Plus aria-hidden />} loading={isPending} disabled={!name.trim()} onClick={create}>Create copy</Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-[16px] p-[20px]">
        <div className="flex flex-wrap gap-[6px]">
          {item.control_ref && <StatusPill size="sm" tone="neutral" label={item.control_ref} />}
          {item.mandatory && <span title={mandatoryNote(frameworkKey)}><StatusPill size="sm" tone="warning" label="Mandatory" /></span>}
          {item.is_platform_native && <StatusPill size="sm" tone="pending" label="Live platform data" />}
          {item.format && <StatusPill size="sm" tone="neutral" label={item.format} />}
        </div>
        <FormField label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={255} /></FormField>
        <FormField label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        <FormField label="Owner" optional>
          <Select placeholder={UNASSIGNED} value={assignedToId ?? ''} onChange={(e) => setAssignedToId(e.target.value ? Number(e.target.value) : null)}>{people(tenantUsers)}</Select>
        </FormField>
        {item.is_platform_native ? (
          <>
            <Notice tone="info" title="Live platform artifact">{`It links to your live ${dataTypeWords(item.platform_data_type)} data. No text to write.`}</Notice>
            {item.platform_data_type && <PlatformDataPanel dataType={item.platform_data_type} />}
          </>
        ) : (
          <ContentBox label="Document text" hint={`(${item.artifact_type} template)`} content={content} onChange={(t) => { typed.current = true; setContent(t); }} />
        )}
      </div>
    </AnimatedModal>
  );
}

// ─── edit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Edit a written copy: name, description, status, owner and text; a live platform copy shows its data and downloads it as a spreadsheet. */
export function EditArtifactModal({ artifact, tenantUsers, onSave, onClose, isPending }: {
  artifact: TenantArtifact; tenantUsers: TenantUser[]; onSave: (data: Partial<TenantArtifact>) => void; onClose: () => void; isPending: boolean;
}) {
  const notify = useNotify();
  const [name, setName] = useState(artifact.name);
  const [content, setContent] = useState(artifact.content || '');
  const [description, setDescription] = useState(artifact.description || '');
  const [status, setStatus] = useState(artifact.status);
  const [assignedToId, setAssignedToId] = useState<number | null>(artifact.assigned_to_id);
  const dirty = name !== artifact.name || content !== (artifact.content || '') || description !== (artifact.description || '') || status !== artifact.status || assignedToId !== artifact.assigned_to_id;

  const live = artifact.is_platform_native && !!artifact.platform_data_type;
  const downloadLive = async () => {
    try { await downloadFromServer(`/artifacts/${artifact.id}/export`, {}, liveExportName(artifact.name)); } catch (e) { notify.error(e, { title: "Couldn't download the file", fallback: 'The file could not be made. Try again.' }); }
  };

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      dirty={dirty}
      title="Edit working copy"
      subtitle={[artifact.artifact_type, (artifact.stage || '').replace(/Stage \d+:\s*/, '')].filter(Boolean).join(' · ')}
      size="xl"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={isPending} disabled={!name.trim()} onClick={() => onSave({ name, content, description, status, assigned_to_id: assignedToId })}>Save changes</Button>
        </div>
      )}
    >
      <div className="space-y-[16px] p-[20px]">
        <FormField label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={255} /></FormField>
        <FormField label="Description" optional><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {artifactStatus.words.map((w) => <option key={w} value={w}>{artifactStatus.label(w)}</option>)}
            </Select>
          </FormField>
          <FormField label="Owner" optional>
            <Select placeholder={UNASSIGNED} value={assignedToId ?? ''} onChange={(e) => setAssignedToId(e.target.value ? Number(e.target.value) : null)}>{people(tenantUsers)}</Select>
          </FormField>
        </div>
        {live ? (
          <>
            <PlatformDataPanel dataType={artifact.platform_data_type as string} />
            <div className="flex justify-end"><Button leftIcon={<Download aria-hidden />} onClick={() => { void downloadLive(); }}>Download the live data as a spreadsheet</Button></div>
          </>
        ) : (
          <ContentBox
            label="Text"
            content={content}
            onChange={setContent}
            extra={<Button size="sm" leftIcon={<Download aria-hidden />} onClick={() => downloadAsFormat(artifact.name, content, artifact.format, artifact.artifact_type)}>Download</Button>}
          />
        )}
      </div>
    </AnimatedModal>
  );
}
