'use client';

// Evidence > Documents to produce: the deliverables the linked frameworks name for this control, with the same life cycle the Frameworks page has (start a working copy, assign it, edit it, send it
// for review, approve it, download it). Reading, starting and editing go through the Frameworks modals, unchanged; a control's documents span several frameworks, so each row carries its own
// framework. Every action reports, and deleting a working copy asks first.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FilePlus2, Pencil, Send, ThumbsUp, Trash2, UserPlus } from 'lucide-react';
import { Button, Combobox, EmptyState, Menu, StatusPill, useConfirm, useReportedMutation, type ListOption, type MenuItem } from '@/components/ui/ds';
import { ArtifactDownload, CreateArtifactModal, EditArtifactModal, ViewArtifactModal, type CatalogItem, type TenantArtifact, type TenantUser } from '@/components/compliance/ArtifactsTab';
import apiClient, { artifactsApi, automationApi, certificationsApi } from '@/lib/api';
import { Loaded, Small } from './parts';
import { useWorkspace } from './workspaceContext';

interface Row { framework_key: string; framework_name: string | null; catalog: CatalogItem; artifact: TenantArtifact | null; required_by: string[]; match_mode?: 'exact' | 'parent' | 'child' | null }

const STATE: Record<string, { tone: 'neutral' | 'pending' | 'success' | 'warning'; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' }, in_review: { tone: 'pending', label: 'In review' }, approved: { tone: 'success', label: 'Approved' }, archived: { tone: 'neutral', label: 'Archived' },
};

export function DocumentsSection() {
  const { code, refresh } = useWorkspace();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [viewing, setViewing] = useState<Row | null>(null);
  const [creating, setCreating] = useState<Row | null>(null);
  const [editing, setEditing] = useState<TenantArtifact | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'started' | 'not_started'>('all');

  const q = useQuery({ queryKey: ['control-artifacts', code], queryFn: async () => (await automationApi.listControlArtifacts(code)).data as { items: Row[] } });
  const users = useQuery({ queryKey: ['control-artifact-users'], queryFn: async () => (await certificationsApi.getTenantUsers()).data as Array<{ id: number; display_name?: string; email?: string }>, staleTime: 5 * 60_000 });
  const tenantUsers: TenantUser[] = useMemo(() => (users.data ?? []).map((u) => ({ id: u.id, label: u.display_name || u.email || 'A person', email: u.email ?? null })), [users.data]);
  const people: ListOption[] = tenantUsers.map((u) => ({ value: String(u.id), label: u.label, description: u.email ?? undefined }));
  const done = () => { void refresh(); void qc.invalidateQueries({ queryKey: ['tenant-artifacts'] }); };

  const create = useReportedMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiClient.post('/artifacts', payload)).data,
    success: { title: 'Working copy started', message: 'It is yours to write and send for review.' }, failure: "Couldn't start the document", retryable: false,
    onSuccess: () => { setCreating(null); done(); },
  });
  const update = useReportedMutation({
    mutationFn: async (v: { id: number; data: Partial<TenantArtifact> }) => (await artifactsApi.update(v.id, v.data)).data,
    success: 'Document saved', failure: "Couldn't save the document", onSuccess: () => { setEditing(null); done(); },
  });
  const remove = useReportedMutation({ mutationFn: (id: number) => artifactsApi.remove(id), success: 'Working copy deleted', failure: "Couldn't delete the document", onSuccess: done });
  const assign = useReportedMutation({
    mutationFn: (v: { id: number; userId: number }) => artifactsApi.assign(v.id, v.userId), success: 'Document assigned', failure: "Couldn't assign the document", onSuccess: () => { setAssigning(null); done(); },
  });
  const setStatus = useReportedMutation({
    mutationFn: (v: { id: number; status: string }) => artifactsApi.update(v.id, { status: v.status }),
    success: (_d, v) => (v.status === 'approved' ? 'Document approved' : v.status === 'in_review' ? 'Sent for review' : 'Status updated'), failure: "Couldn't change the status", onSuccess: done,
  });

  const askDelete = async (a: TenantArtifact) => {
    if (await confirm({ title: 'Delete this working copy?', message: `“${a.name}” and what was written in it go. The framework’s own document is not affected.`, confirmLabel: 'Delete', tone: 'danger' })) remove.mutate(a.id);
  };

  return (
    <Loaded q={q} what="the documents" rows={3}>
      {(data) => {
        const items = data.items ?? [];
        if (!items.length) return <EmptyState kind="firstUse" bare title="No documents named" description="None of the frameworks you are assessed against names a specific document to produce for this control." />;
        const shown = items.filter((i) => (filter === 'all' ? true : filter === 'started' ? !!i.artifact : !i.artifact));
        const started = items.filter((i) => i.artifact).length;
        const approved = items.filter((i) => i.artifact?.status === 'approved').length;
        return (
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-wrap items-center gap-[6px]">
              {([['all', 'All'], ['started', 'Started'], ['not_started', 'Not started']] as const).map(([k, l]) => (
                <Button key={k} size="sm" variant={filter === k ? 'primary' : 'secondary'} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</Button>
              ))}
              <Small className="ml-auto">{`${started} of ${items.length} started · ${approved} approved`}</Small>
            </div>
            <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
              {shown.map((row) => {
                const c = row.catalog;
                const a = row.artifact;
                const st = a ? STATE[a.status] ?? STATE.draft : null;
                const menu: MenuItem[] = [
                  { key: 'view', label: 'Read it', icon: Eye, onSelect: () => setViewing(row) },
                  ...(a ? [
                    { key: 'assign', label: 'Assign to someone', icon: UserPlus, onSelect: () => setAssigning(a.id) },
                    { key: 'review', label: 'Send for review', icon: Send, hidden: a.status === 'in_review' || a.status === 'approved', onSelect: () => setStatus.mutate({ id: a.id, status: 'in_review' }) },
                    { key: 'approve', label: 'Approve', icon: ThumbsUp, hidden: a.status !== 'in_review', onSelect: () => setStatus.mutate({ id: a.id, status: 'approved' }) },
                    { key: 'delete', label: 'Delete the working copy', icon: Trash2, danger: true, onSelect: () => { void askDelete(a); } },
                  ] : []),
                ];
                return (
                  <li key={`${row.framework_key}-${c.artifact_id}`} className="px-[12px] py-[10px]">
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <button type="button" onClick={() => setViewing(row)} className="min-w-0 flex-1 basis-[14rem] rounded-ds-control text-left text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{a?.name || c.name}</button>
                      {c.format && <StatusPill size="sm" tone="neutral" label={c.format} />}
                      {c.mandatory && <StatusPill size="sm" tone="warning" label="Required" />}
                      {row.match_mode === 'parent' && <span title="Attached through a section-level reference, a weaker claim"><StatusPill size="sm" tone="neutral" label="Section-level" /></span>}
                      {st ? <StatusPill size="sm" tone={st.tone} label={st.label} /> : <StatusPill size="sm" tone="neutral" label="Not started" />}
                      {a ? <Button variant="primary" size="sm" leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(a)}>Edit and review</Button>
                        : <Button size="sm" variant="primary" leftIcon={<FilePlus2 aria-hidden />} onClick={() => setCreating(row)}>Start</Button>}
                      {a && <ArtifactDownload artifact={a} label="Download" />}
                      <Menu label={`Actions for ${a?.name || c.name}`} iconOnly size="sm" items={menu} />
                    </div>
                    {assigning != null && a && assigning === a.id && (
                      <div className="mt-[8px] max-w-[320px]"><Combobox label="Assign to" options={people} value={a.assigned_to_id != null ? String(a.assigned_to_id) : null} onChange={(v) => { if (v) assign.mutate({ id: a.id, userId: Number(v) }); else setAssigning(null); }} placeholder="Choose a person" searchPlaceholder="Search people" /></div>
                    )}
                    {c.description && <p className="mt-[4px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{c.description}</p>}
                    <Small className="mt-[2px]">{[row.framework_name, a?.assigned_to_name ? `Assigned to ${a.assigned_to_name}` : (c.owner && `Suggested owner: ${c.owner}`), c.has_content ? 'A starter document is available' : 'No starter document yet'].filter(Boolean).join(' · ')}</Small>
                  </li>
                );
              })}
            </ul>
            {viewing && <ViewArtifactModal item={viewing.catalog} frameworkKey={viewing.framework_key} onClose={() => setViewing(null)} onCreate={viewing.artifact ? undefined : () => { setCreating(viewing); setViewing(null); }} />}
            {creating && <CreateArtifactModal item={creating.catalog} frameworkKey={creating.framework_key} frameworkName={creating.framework_name || creating.framework_key} tenantUsers={tenantUsers} onConfirm={(payload) => create.mutate(payload)} onClose={() => setCreating(null)} isPending={create.isPending} />}
            {editing && <EditArtifactModal artifact={editing} tenantUsers={tenantUsers} onSave={(data) => update.mutate({ id: editing.id, data })} onClose={() => setEditing(null)} isPending={update.isPending} />}
            {confirmDialog}
          </div>
        );
      }}
    </Loaded>
  );
}
