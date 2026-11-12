'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, FileText, Plus, Send } from 'lucide-react';
import { committeeApi, ermApi } from '@/lib/api';
import { saveBlob } from '@/lib/studio/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Button, EmptyState, ErrorState, FormField, Notice, Select, StatusPill, TextInput, Textarea } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import {
  changedCommentary, formatCell, groupByCommittee, MONEY_SECTIONS, PACK_STATUS, packActions,
  type CommitteePack, type PackSection,
} from './packModel';

const CARD = 'rounded-xl border border-slate-200 bg-white p-4';
const PACKS = ['erm-committee-packs'];
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

interface Option { id: number; name?: string; title?: string; scheduled_date?: string }

function BuildForm({ onBuilt, onCancel }: { onBuilt: (id: number) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [committeeId, setCommitteeId] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const committees = useQuery({
    queryKey: ['committees-active'],
    queryFn: async () => ((await committeeApi.getCommittees()).data as { items: Option[] }).items,
  });
  const meetings = useQuery({
    queryKey: ['committee-meetings-scheduled', committeeId],
    queryFn: async () => ((await committeeApi.getMeetings(Number(committeeId), { status: 'scheduled' })).data as { items: Option[] }).items,
    enabled: !!committeeId,
  });
  const build = useReportedMutation({
    mutationFn: async () => (await ermApi.reports.packs.build({
      title: title.trim(), committee_id: committeeId ? Number(committeeId) : null, meeting_id: meetingId ? Number(meetingId) : null,
    })).data as { id: number },
    success: 'Pack built from live data',
    failure: "Couldn't build the pack",
    retryable: false,
    invalidate: [PACKS],
    onSuccess: (made) => onBuilt(made.id),
  });
  const committeeList = committees.data ?? [];

  return (
    <div className={`${CARD} space-y-3`}>
      <h3 className="font-medium text-slate-900">Build pack</h3>
      <p className="text-sm text-slate-600">The numbers are read from the register, KRIs, loss events, actions and reviews now, and kept as they are.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Title" required>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Board Risk Committee, Q4 2026" maxLength={255} />
        </FormField>
        <FormField label="Committee" optional>
          <Select value={committeeId} placeholder="No committee" onChange={(e) => { setCommitteeId(e.target.value); setMeetingId(''); }}>
            {committeeList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Meeting" optional hint="The frozen pack is added to the meeting's papers">
          <Select value={meetingId} placeholder={committeeId ? 'No meeting' : 'Choose a committee first'} disabled={!committeeId}
            onChange={(e) => setMeetingId(e.target.value)}>
            {(meetings.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.title} · {day(m.scheduled_date)}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" loading={build.isPending} disabled={!title.trim()} onClick={() => build.mutate()}>Build pack</Button>
      </div>
    </div>
  );
}

function SectionTable({ section }: { section: PackSection }) {
  if (section.rows.length === 0) return <p className="text-sm text-slate-500">None.</p>;
  const money = MONEY_SECTIONS.has(section.key);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            {section.columns.map((c) => <th key={c} scope="col" className="py-1.5 pr-3 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              {row.map((cell, j) => <td key={j} className="py-1.5 pr-3 text-slate-700">{formatCell(cell, money)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PackDetail({ id, canEdit, onBack }: { id: number; canEdit: boolean; onBack: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: [...PACKS, id],
    queryFn: async () => (await ermApi.reports.packs.get(id)).data as CommitteePack,
  });
  const pack = q.data;
  const saved = pack?.commentary ?? {};
  const changes = changedCommentary(saved, draft);
  const dirty = Object.keys(changes).length > 0;

  const save = useReportedMutation({
    mutationFn: () => ermApi.reports.packs.update(id, { commentary: changes }),
    success: 'Commentary saved', failure: "Couldn't save the commentary", invalidate: [PACKS], onSuccess: () => setDraft({}),
  });
  const ready = useReportedMutation({
    mutationFn: () => ermApi.reports.packs.ready(id),
    success: 'Pack is ready for approval', failure: "Couldn't mark the pack ready", invalidate: [PACKS],
  });
  const freeze = useReportedMutation({
    mutationFn: () => ermApi.reports.packs.freeze(id),
    success: () => (pack?.meeting_id ? 'Pack approved, frozen and added to the meeting papers' : 'Pack approved and frozen'),
    failure: "Couldn't approve the pack", invalidate: [PACKS],
  });
  const exportFile = useReportedMutation({
    mutationFn: async (format: 'pdf' | 'xlsx') => {
      const { data } = await ermApi.reports.packs.export(id, format);
      saveBlob(data as Blob, `${pack?.title || 'committee-pack'}.${format}`);
    },
    success: 'Pack downloaded', failure: "Couldn't export the pack",
  });

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading the pack…</p>;
  if (q.isError || !pack) {
    return <ErrorState title="Couldn't load the pack" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />;
  }
  const actions = packActions(pack, canEdit);
  const editing = actions.includes('edit');
  const status = PACK_STATUS[pack.status];

  return (
    <div className="space-y-4">
      <Button variant="link" leftIcon={<ArrowLeft />} onClick={onBack}>All packs</Button>
      <div className={`${CARD} space-y-2`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">{pack.title}</h3>
              <StatusPill tone={status.tone} label={status.label} />
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {pack.committee_name || 'No committee'}{pack.meeting_title ? ` · ${pack.meeting_title}, ${day(pack.meeting_date)}` : ''}
            </p>
            <p className="text-xs text-slate-500">
              Built from live data on {day(pack.built_at)} by {pack.prepared_by_name || '—'}
              {pack.approved_at ? ` · approved and frozen by ${pack.approved_by_name || '—'} on ${day(pack.approved_at)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.includes('ready') && (
              <Button variant="secondary" leftIcon={<Send />} loading={ready.isPending} disabled={dirty}
                title={dirty ? 'Save the commentary first' : undefined} onClick={() => ready.mutate()}>Mark ready</Button>
            )}
            {actions.includes('freeze') && (
              <Button variant="primary" leftIcon={<CheckCircle2 />} loading={freeze.isPending} disabled={dirty}
                title={dirty ? 'Save the commentary first' : undefined} onClick={() => freeze.mutate()}>Approve and freeze</Button>
            )}
            {actions.includes('export') && (
              <>
                <Button variant="secondary" leftIcon={<FileText />} loading={exportFile.isPending && exportFile.variables === 'pdf'}
                  onClick={() => exportFile.mutate('pdf')}>Export PDF</Button>
                <Button variant="secondary" leftIcon={<FileSpreadsheet />} loading={exportFile.isPending && exportFile.variables === 'xlsx'}
                  onClick={() => exportFile.mutate('xlsx')}>Export Excel</Button>
              </>
            )}
          </div>
        </div>
        {pack.status === 'ready' && !pack.can_freeze && (
          <Notice tone="info">Waiting for approval. Someone other than the preparer approves and freezes the pack.</Notice>
        )}
        {pack.summary && <p className="text-sm text-slate-700">{pack.summary}</p>}
      </div>

      {(pack.sections ?? []).map((section) => (
        <section key={section.key} className={CARD} aria-labelledby={`pack-${section.key}`}>
          <h4 id={`pack-${section.key}`} className="mb-3 font-medium text-slate-900">{section.title}</h4>
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <SectionTable section={section} />
            {editing ? (
              <FormField label="Commentary">
                <Textarea rows={4} value={draft[section.key] ?? saved[section.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [section.key]: e.target.value }))} />
              </FormField>
            ) : (
              <div>
                <p className="text-xs font-medium text-slate-500">Commentary</p>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{saved[section.key] || '—'}</p>
              </div>
            )}
          </div>
        </section>
      ))}

      {editing && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => setDraft({})}>Discard changes</Button>
          <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save commentary</Button>
        </div>
      )}
    </div>
  );
}

/** The Committee packs tab: packs by committee and date with their status, building one, and one pack's review. */
export default function CommitteePacks() {
  const { hasAnyPermission } = usePermissions();
  const canCreate = hasAnyPermission(['erm:risks:create', 'risks:risk_register:create']);
  const canEdit = hasAnyPermission(['erm:risks:edit', 'risks:risk_register:edit']);
  const [openId, setOpenId] = useState<number | null>(null);
  const [building, setBuilding] = useState(false);
  const q = useQuery({
    queryKey: PACKS,
    queryFn: async () => (await ermApi.reports.packs.list()).data as CommitteePack[],
  });

  if (openId !== null) return <PackDetail id={openId} canEdit={canEdit} onBack={() => setOpenId(null)} />;
  if (q.isError) return <ErrorState title="Couldn't load the committee packs" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />;

  const groups = groupByCommittee(q.data ?? []);
  const buildButton = canCreate && !building && (
    <Button variant="primary" leftIcon={<Plus />} onClick={() => setBuilding(true)}>Build pack</Button>
  );

  return (
    <div className="space-y-4">
      {building && <BuildForm onBuilt={(id) => { setBuilding(false); setOpenId(id); }} onCancel={() => setBuilding(false)} />}
      {q.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : groups.length === 0 ? (
        !building && <EmptyState kind="firstUse" title="No packs yet." action={buildButton || undefined} />
      ) : (
        <>
          {buildButton && <div className="flex justify-end">{buildButton}</div>}
          {groups.map((group) => (
            <div key={group.committee} className={CARD}>
              <h3 className="font-medium text-slate-900">{group.committee}</h3>
              <ul className="mt-3 divide-y divide-slate-100">
                {group.packs.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setOpenId(p.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50">
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{p.title}</span>
                        <span className="block text-xs text-slate-500">
                          {p.meeting_title ? `${p.meeting_title}, ${day(p.meeting_date)}` : 'No meeting'} · built {day(p.built_at)}
                        </span>
                      </span>
                      <StatusPill tone={PACK_STATUS[p.status].tone} label={PACK_STATUS[p.status].label} size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
