'use client';

// A normalized set (one requirement shared by several frameworks) or a standalone control, as a Sheet: the controls it brings together, the evidence it asks for, the artifacts it names (each downloadable
// as a blank starter Word document) and an upload that is linked to every member control at once. Under a built view the members of the picked frameworks come first and the others sit behind a button.
import { useState } from 'react';
import { CheckCircle2, Download, FileText, Upload } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AccordionRow, Button, EmptyState, Sheet, StatusPill, TabPanel, Tabs, useReportedMutation } from '@/components/ui/ds';
import apiClient from '@/lib/api';
import { formatCount } from '@/lib/format';
import { FilePick } from '@/app/(dashboard)/controls/_catalog/FilePick';
import { artifactDocument, artifactFileName, type Art, type SetT } from './domainModel';
import { shortFramework as sf } from './libraryModel';

const TABS = ['members', 'evidence', 'artifacts', 'upload'] as const;
type Tab = (typeof TABS)[number];

function download(art: Art, domain: string) {
  const blob = new Blob(['﻿', artifactDocument(art, domain)], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = artifactFileName(art);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Upload { id: number; name: string; file_name: string; linked_controls: number; status: string }

function UploadPane({ set }: { set: SetT }) {
  const nc = set.nc_id;
  const list = useQuery({
    queryKey: ['control-library-uploads', nc],
    enabled: !!nc,
    queryFn: async () => (await apiClient.get(`/control-library/groups/normalized/${nc}/evidence`)).data.items as Upload[],
  });
  const send = useReportedMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name);
      return (await apiClient.post(`/control-library/groups/normalized/${nc}/evidence`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data as { message?: string };
    },
    success: (r) => ({ title: 'Evidence uploaded', message: r?.message || 'It is linked to every member control and saved to the Evidence Library.' }),
    failure: "Couldn't upload the evidence",
    invalidate: [['control-library-uploads', nc]],
  });
  if (!nc) return <p className="m-0 text-ds-body text-ds-fg-muted">This control is not linked to a unified control, so evidence cannot be uploaded to it here.</p>;
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="m-0 rounded-ds-card bg-ds-primary-soft p-[12px] text-ds-body text-ds-fg-body">
        Upload evidence once here: it is linked to all {formatCount(set.member_count)} member controls across frameworks, saved to the Evidence Library, and attached to each framework requirement automatically.
      </p>
      <div><FilePick primary icon={<Upload aria-hidden className="h-[16px] w-[16px]" />} busy={send.isPending} onPick={(f) => send.mutate(f)}>Choose an evidence file</FilePick></div>
      <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{`Uploaded evidence (${formatCount(list.data?.length ?? 0)})`}</h3>
      {list.isError ? <p role="alert" className="m-0 text-ds-body text-ds-danger">The uploaded evidence could not be loaded. <button type="button" className="underline" onClick={() => { void list.refetch(); }}>Retry</button></p>
        : (list.data ?? []).length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No evidence uploaded yet for this set.</p>
        : (
          <ul className="m-0 list-none divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
            {(list.data ?? []).map((u) => (
              <li key={u.id} className="flex items-center gap-[8px] p-[12px]">
                <span className="min-w-0 flex-1"><span className="block truncate text-ds-body font-[600] text-ds-fg" title={u.name}>{u.name}</span><span className="text-ds-label text-ds-fg-muted">{`${u.file_name} · linked to ${formatCount(u.linked_controls)} controls`}</span></span>
                <StatusPill size="sm" tone="success" label={u.status} />
              </li>
            ))}
          </ul>
        )}
      <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{`Recommended evidence to provide (${formatCount(set.normalized_evidence.length)})`}</h3>
      <ul className="m-0 list-disc pl-[20px] text-ds-body text-ds-fg-body">{set.normalized_evidence.map((e, i) => <li key={i}>{e.name}</li>)}</ul>
    </div>
  );
}

export function SetSheet({ set, domain, picked, onClose }: { set: SetT | null; domain: string; picked: readonly string[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('members');
  const [others, setOthers] = useState(false);
  if (!set) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const filterOn = picked.length > 0;
  const mine = filterOn ? set.members.filter((m) => picked.includes(sf(m.framework))) : set.members;
  const rest = filterOn ? set.members.filter((m) => !picked.includes(sf(m.framework))) : [];
  const standalone = set.member_count <= 1;
  const tabs = [
    { key: 'members', label: 'Frameworks', count: set.member_count },
    { key: 'evidence', label: 'Evidence', count: set.normalized_evidence.length },
    { key: 'artifacts', label: 'Artifacts', count: set.normalized_artifacts.length },
    { key: 'upload', label: 'Upload evidence' },
  ];
  const Member = ({ m, muted }: { m: SetT['members'][number]; muted: boolean }) => (
    <li className={`rounded-ds-card border p-[12px] ${muted ? 'border-ds-border bg-ds-surface-subtle' : 'border-ds-border bg-ds-surface'}`}>
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill size="sm" tone={muted ? 'neutral' : 'progress'} label={sf(m.framework)} />
        <span className="font-mono text-ds-label text-ds-fg-muted">{m.control_id}</span>
        {!muted && filterOn && <span className="text-ds-label font-[600] text-ds-primary-text">In your view</span>}
      </div>
      <p className="m-0 mt-[4px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{m.original_title}</p>
    </li>
  );
  return (
    <Sheet
      open
      onClose={onClose}
      width="md"
      title={set.normalized_title || set.members[0]?.original_title || ''}
      subtitle={standalone ? `Standalone control · ${sf(set.members[0]?.framework || '')} · unique to one framework` : `Normalized set · ${formatCount(set.member_count)} frameworks · one control per framework`}
    >
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as Tab)} ariaLabel="About this control" countFormat="exact">
        <TabPanel tabKey="members" className="pt-[16px]">
          <p className="m-0 mb-[8px] text-ds-label text-ds-fg-muted">{`One control per framework, original titles kept${filterOn && rest.length > 0 ? ` · ${formatCount(set.member_count)} frameworks share this requirement` : ''}`}</p>
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">{mine.map((m, i) => <Member key={`m${i}`} m={m} muted={false} />)}</ul>
          {rest.length > 0 && (
            <div className="mt-[8px]">
              <AccordionRow title={`Also normalized with ${formatCount(rest.length)} other ${rest.length === 1 ? 'framework' : 'frameworks'} sharing this requirement`} region={false} open={others} onOpenChange={setOthers}>
                <ul className="m-0 flex list-none flex-col gap-[8px] p-[12px]">{rest.map((m, i) => <Member key={`o${i}`} m={m} muted />)}</ul>
              </AccordionRow>
            </div>
          )}
        </TabPanel>
        <TabPanel tabKey="evidence" lazy className="pt-[16px]">
          {set.normalized_evidence.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">Evidence pending: the sources do not name any yet.</p> : (
            <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
              {set.normalized_evidence.map((e, i) => <li key={i} className="flex items-start gap-[8px] text-ds-body text-ds-fg-body"><CheckCircle2 aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0 text-ds-success" />{e.name}</li>)}
            </ul>
          )}
        </TabPanel>
        <TabPanel tabKey="artifacts" lazy className="pt-[16px]">
          {set.normalized_artifacts.length === 0 ? (
            <div className="rounded-ds-card border border-ds-border"><EmptyState kind="firstUse" bare icon={FileText} title="No requirement-specific artifacts" description="Supporting templates are in the domain’s framework-level catalogs." /></div>
          ) : (
            <>
              <p className="m-0 mb-[8px] text-ds-label text-ds-fg-muted">Each artifact downloads as a blank starter document to fill in.</p>
              <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
                {set.normalized_artifacts.map((a, i) => (
                  <li key={i} className="flex items-center gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
                    <span className="min-w-0 flex-1 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{a.name}{a.type && <span className="text-ds-fg-muted">{` · ${a.type}`}</span>}</span>
                    <Button size="sm" leftIcon={<Download aria-hidden />} onClick={() => download(a, domain)}>Download</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </TabPanel>
        <TabPanel tabKey="upload" lazy className="pt-[16px]"><UploadPane set={set} /></TabPanel>
      </Tabs>
    </Sheet>
  );
}
