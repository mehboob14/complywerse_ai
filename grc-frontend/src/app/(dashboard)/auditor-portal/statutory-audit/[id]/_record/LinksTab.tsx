'use client';

// The observation's linkages: the controls, risks, issues and governance documents it relates to. Each one is a link to the record itself (an internal control has no page of its own in the
// platform, so it is named), with the record's own state beside it; unlinking asks first and the record stays where it is. "Link" opens the picker for that kind.
import Link from 'next/link';
import { Link2, Link2Off } from 'lucide-react';
import { Button, IconButton, SectionCard, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { statutoryAuditApi } from '@/lib/api';
import { statusLabel, truncate } from '@/lib/format';
import { REFRESH, type RecordDetail } from '../../_register/observationData';
import type { LinkKind } from './LinkPicker';

interface Item { id: number; label: string; href: string | null; state?: string | null }

const LINK = 'inline-flex min-h-ds-control max-w-full items-center break-words text-ds-body font-[600] text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring [overflow-wrap:anywhere]';

const unlinkFn = (kind: Exclude<LinkKind, 'evidence'>, obsId: number, linkId: number) => {
  switch (kind) {
    case 'controls': return statutoryAuditApi.unlinkControl(obsId, linkId);
    case 'risks': return statutoryAuditApi.unlinkRisk(obsId, linkId);
    case 'issues': return statutoryAuditApi.unlinkIssue(obsId, linkId);
    default: return statutoryAuditApi.unlinkDocument(obsId, linkId);
  }
};

/** The four kinds of linked record as rows. A control is named (the platform has no page for one); the others open their own page. */
export function linkedItems(o: RecordDetail): Record<Exclude<LinkKind, 'evidence'>, Item[]> {
  return {
    controls: o.controls.map((r) => ({ id: r.id, label: [r.control_id, r.name].filter(Boolean).join(' · ') || 'A control', href: null })),
    risks: o.risks.map((r) => ({ id: r.id, label: r.title || 'A risk', href: `/erm/risks/${r.risk_id}`, state: r.severity })),
    issues: o.issues.map((r) => ({ id: r.id, label: [r.code, r.title].filter(Boolean).join(' · ') || 'An issue', href: `/issues/${r.issue_id}`, state: r.status })),
    documents: o.documents.map((r) => ({ id: r.id, label: r.title || 'A document', href: `/governance/documents/${r.document_id}`, state: r.status })),
  };
}

const SECTIONS: Array<{ kind: Exclude<LinkKind, 'evidence'>; title: string; empty: string; one: string }> = [
  { kind: 'controls', title: 'Controls', empty: 'No controls linked.', one: 'control' },
  { kind: 'risks', title: 'Risks', empty: 'No risks linked.', one: 'risk' },
  { kind: 'issues', title: 'Issues', empty: 'No issues linked.', one: 'issue' },
  { kind: 'documents', title: 'Governance documents', empty: 'No documents linked.', one: 'document' },
];

export function LinksTab({ o, onLink }: { o: RecordDetail; onLink: (kind: LinkKind) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const items = linkedItems(o);
  const unlink = useReportedMutation({
    mutationFn: async (v: { kind: Exclude<LinkKind, 'evidence'>; id: number }) => (await unlinkFn(v.kind, o.id, v.id)).data,
    success: 'Unlinked',
    failure: "Couldn't unlink it",
    invalidate: REFRESH,
  });
  const ask = async (kind: Exclude<LinkKind, 'evidence'>, one: string, row: Item) => {
    const yes = await confirm({ title: `Unlink this ${one}?`, message: `“${truncate(row.label, 80).text}” stays where it is; it just stops being linked to this observation.`, confirmLabel: `Unlink ${one}`, tone: 'danger' });
    if (yes) unlink.mutate({ kind, id: row.id });
  };
  return (
    <div className="flex flex-col gap-[16px]">
      {SECTIONS.map((s) => (
        <SectionCard key={s.kind} id={s.kind} title={s.title} meta={items[s.kind].length ? String(items[s.kind].length) : undefined} actions={<Button leftIcon={<Link2 aria-hidden />} onClick={() => onLink(s.kind)}>{`Link a ${s.one}`}</Button>}>
          {items[s.kind].length === 0 ? (
            <p className="text-ds-body text-ds-fg-muted">{s.empty}</p>
          ) : (
            <ul aria-label={s.title} className="m-0 flex list-none flex-col rounded-ds-card border border-ds-border p-0">
              {items[s.kind].map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-b border-ds-border px-[12px] py-[4px] last:border-b-0">
                  <div className="min-w-0 flex-1 basis-[12rem]">
                    {row.href ? <Link href={row.href} className={LINK}>{row.label}</Link> : <span className="inline-flex min-h-ds-control items-center break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{row.label}</span>}
                  </div>
                  {row.state && <StatusPill size="sm" tone="neutral" label={statusLabel(row.state)} />}
                  <IconButton label={`Unlink ${truncate(row.label, 60).text}`} onClick={() => { void ask(s.kind, s.one, row); }}><Link2Off aria-hidden /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ))}
      {confirmDialog}
    </div>
  );
}
