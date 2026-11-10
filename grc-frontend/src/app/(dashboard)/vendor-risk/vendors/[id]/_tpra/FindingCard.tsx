'use client';

// THE finding, drawn once: severity, title, the Blocking badge, the detail, "Source · Treatment · raised · due", its status, the risk-register link, the box of an accepted risk and what can be
// done to it: an owner, Start remediation, Close, Accept risk, Reopen, Share with the vendor, Promote to risk, remove and restore. It is the card of the Findings register's drawer, of the vendor
// record's Findings tab and of the lifecycle's Findings stage (they used to be three screens). Under "Details": remediation tasks, risk acceptances and evidence. Rebuilt on the kit
// (vendor-intake-findings, 2026-11-10): every change reports (a confirmation, or the failure with what the server said and a Retry), a destructive one asks first, the people are the
// module's own list and a person who has left reads "A former colleague", never a number.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Info, RotateCcw, Send, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { Button, ClampedText, IconButton, Notice, PersonChip, Select, StatusPill, linkClasses, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { tpraApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorFinding, vendorTier } from '@/lib/statuses/vendor';
import { findingsApi, refreshFindings, type FindingRow } from '../../../_lib/findingsApi';
import { dueOf, isOpen, isSettled, sourceLabel, treatmentLabel } from '../../../_lib/findingCardModel';
import { pickable, personName } from '../../../_lib/peopleModel';
import type { SupplierRequest } from '../../../_lib/requestsApi';
import { AcceptDialog, AddRemediationPanel, CloseDialog, ReopenDialog, ShareFindingPanel } from './FindingDialogs';
import EvidencePanel from './EvidencePanel';
import { DOMAIN_LABELS } from './constants';
import type { Acceptance, FindingDetail, Remediation } from './types';

export interface Rights { edit: boolean; accept: boolean; remove: boolean }

/** What the signed-in person may do to a finding, as the server holds it: the module's own right, or the risk right every write of the module accepts; accepting a risk has no fallback. */
export function useFindingRights(): { rights: Rights; canRaise: boolean } {
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');
  return {
    rights: { edit: hasPermission('vendor_risk:findings:edit') || erm, accept: hasPermission('vendor_risk:findings:accept_risk'), remove: hasPermission('vendor_risk:findings:delete') || erm },
    canRaise: hasPermission('vendor_risk:findings:create') || erm,
  };
}

/** A finding as the statuses of the module say it. */
export const FindingStatus = ({ status }: { status: string }) => <StatusPill {...statusPill(vendorFinding, status)} />;
export const SeverityPill = ({ severity }: { severity: string }) => <StatusPill size="sm" {...statusPill(vendorTier, severity)} />;

const CHIP = 'inline-flex max-w-full min-w-0 items-center gap-[4px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label font-normal text-ds-fg-body';

export default function FindingCard({
  finding: f, people, rights, shared, expanded, onToggle, highlight = false, onChanged, as = 'li',
}: {
  finding: FindingRow;
  people: Array<{ id: number; name: string }>;
  rights: Rights;
  /** the open request that asks the vendor for a plan to fix it */
  shared?: SupplierRequest;
  /** the Details open */
  expanded: boolean;
  onToggle: () => void;
  /** the deep-linked finding */
  highlight?: boolean;
  onChanged?: () => void;
  /** `li` in a list; `div` where the card stands alone (the register's drawer) */
  as?: 'li' | 'div';
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [accepting, setAccepting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [problem, setProblem] = useState<{ accept?: unknown; close?: unknown; reopen?: unknown }>({});
  const said = (key: 'accept' | 'close' | 'reopen') => (e: unknown) => setProblem((p) => ({ ...p, [key]: e }));
  const unsaid = (key: 'accept' | 'close' | 'reopen') => setProblem((p) => ({ ...p, [key]: undefined }));

  const done = () => { refreshFindings(qc); onChanged?.(); };

  const owner = useReportedMutation({
    mutationFn: (id: number | null) => findingsApi.setOwner(f.id, id),
    success: 'Owner saved',
    failure: 'Owner not saved',
    onSuccess: done,
  });
  const start = useReportedMutation({
    mutationFn: async () => (await findingsApi.startRemediation(f.id)).data,
    success: (made) => (made.owner?.name ? `Remediation task opened for ${made.owner.name}` : 'Remediation task opened'),
    failure: 'Remediation not started',
    onSuccess: done,
  });
  const accept = useReportedMutation({
    mutationFn: (p: { rationale: string; expiry?: string }) => tpraApi.createAcceptance(f.id, p),
    success: 'Risk accepted',
    failure: 'Not accepted',
    toast: 'success',
    onError: said('accept'),
    onSuccess: () => { setAccepting(false); done(); },
  });
  const close = useReportedMutation({
    mutationFn: (note: string) => findingsApi.close(f.id, note),
    success: 'Finding closed',
    failure: 'Not closed',
    toast: 'success',
    onError: said('close'),
    onSuccess: () => { setClosing(false); done(); },
  });
  const reopen = useReportedMutation({
    mutationFn: (reason: string) => findingsApi.reopen(f.id, reason),
    success: 'Finding reopened',
    failure: 'Not reopened',
    toast: 'success',
    onError: said('reopen'),
    onSuccess: () => { setReopening(false); done(); },
  });
  const promote = useReportedMutation({
    mutationFn: async () => (await tpraApi.promoteFindingToRegister(f.id)).data as { risk_id?: number },
    success: (res) => ({ title: 'Moved to the Risk Register', message: res?.risk_id ? 'Opening it so you can complete the risk details.' : 'A vendor-sourced risk was created in the register.' }),
    failure: 'Not moved to the Risk Register',
    onSuccess: (res) => {
      done();
      // Land the person on THIS risk in the register to fill the required fields.
      if (res?.risk_id) router.push(`/erm/risks/list?edit=${res.risk_id}`);
    },
  });
  const remove = useReportedMutation({
    mutationFn: () => tpraApi.deleteFinding(f.id),
    success: 'Finding removed',
    failure: 'Not removed',
    onSuccess: done,
  });
  const restore = useReportedMutation({
    mutationFn: () => tpraApi.restoreFinding(f.id),
    success: 'Finding restored',
    failure: 'Not restored',
    onSuccess: done,
  });
  const askRemove = async () => {
    const yes = await confirm({
      title: 'Remove this finding?',
      message: 'It leaves the lists and the counts. "Show removed" brings it back, and Restore puts it back for good.',
      confirmLabel: 'Remove finding',
      tone: 'danger',
    });
    if (yes) remove.mutate();
  };

  const removed = !!f.deleted_at;
  const open = isOpen(f.status);
  const due = dueOf(f);
  const story = [sourceLabel(f.source), treatmentLabel(f.treatment), `raised ${formatDate(f.created_at)}`].filter(Boolean);
  const named = f.owner?.name ?? personName(people, f.owner_id);
  const Root = as;

  return (
    <Root id={`tpra-finding-${f.id}`} className={`scroll-mt-[16px] list-none py-[12px] ${removed ? 'opacity-60' : ''} ${highlight ? 'rounded-ds-card bg-ds-primary-soft px-[12px] ring-1 ring-ds-border-strong' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
            <SeverityPill severity={f.severity} />
            <span dir="auto" className="min-w-0 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{f.title || 'Untitled finding'}</span>
            {f.is_blocking && <span title="Blocks approval until closed or accepted"><StatusPill size="sm" tone="danger" label="Blocking" /></span>}
            {f.is_critical_control_fail && <span title="A failed critical control"><StatusPill size="sm" tone="danger" label="Critical control" /></span>}
            <span className={CHIP}>{DOMAIN_LABELS[f.domain] || f.domain}</span>
            {f.engagement?.name && <span className={CHIP} title="The engagement this is about">{f.engagement.name}</span>}
            {f.linked_issue_id && (
              <Link href={`/issues/${f.linked_issue_id}`} title="Tracked as an Issue: one owner, SLA and workflow" className={`${CHIP} hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring`}>
                <ArrowUpRight aria-hidden className="h-[12px] w-[12px]" /> Tracked as an issue
              </Link>
            )}
            {shared && (
              <span title="Shared with the vendor: see Requests and messages"><StatusPill size="sm" tone={shared.status === 'submitted' ? 'success' : 'progress'} label={shared.status === 'submitted' ? 'Vendor answered' : 'With vendor'} /></span>
            )}
          </div>
          {f.description && <ClampedText className="mt-[4px]" text={f.description} lines={3} />}
          <p className="mt-[4px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label text-ds-fg-muted">
            {story.map((part, i) => <span key={part}>{i > 0 && <span aria-hidden className="mr-[8px]">·</span>}{part}</span>)}
            {due.text && (
              <span className={due.overdue ? 'font-[600] text-ds-danger' : undefined}><span aria-hidden className="mr-[8px] font-normal text-ds-fg-muted">·</span>{due.text}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          {f.linked_risk_id ? (
            <Link href={`/erm/risks/list?edit=${f.linked_risk_id}`} title="Open this risk in the Risk Register" className={`inline-flex items-center gap-[4px] ${linkClasses({ tone: 'text', size: 'label' })}`}>
              <ArrowUpRight aria-hidden className="h-[14px] w-[14px]" /> In the Risk Register
            </Link>
          ) : rights.edit && !removed ? (
            <Button variant="ghost" size="sm" loading={promote.isPending} leftIcon={<ArrowUpRight aria-hidden />} title="Move this finding into the Risk Register as a vendor-sourced risk" onClick={() => promote.mutate()}>Promote to risk</Button>
          ) : null}
          <FindingStatus status={f.status} />
        </div>
      </div>

      {f.status === 'accepted' && (
        <Notice tone="info" className="mt-[8px]" title={f.accepted_until ? `Accepted until ${formatDate(f.accepted_until, { calendar: true })}` : 'Accepted, with no end date'}>
          <span className="whitespace-pre-line">{f.acceptance?.rationale || 'No rationale recorded.'}</span>
        </Notice>
      )}

      <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
        {removed ? (
          rights.edit && <Button size="sm" leftIcon={<RotateCcw aria-hidden />} loading={restore.isPending} onClick={() => restore.mutate()}>Restore</Button>
        ) : (
          <>
            {open && rights.edit ? (
              <Select
                aria-label={`Owner of ${f.title || 'this finding'}`} className="w-[208px]" value={f.owner_id ?? ''} disabled={owner.isPending} placeholder="Assign an owner"
                onChange={(e) => owner.mutate(e.target.value ? Number(e.target.value) : null)}
              >
                {pickable(people, f.owner_id, f.owner?.name).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : (named || open) ? (
              <PersonChip name={named} size={20} />
            ) : null}
            {open && rights.edit && (
              f.task_id ? (
                <Link href={`/tasks/${f.task_id}`} title={f.task?.status ? `The task is ${f.task.status.toLowerCase()}` : 'Open the task'} className={`inline-flex items-center gap-[6px] ${linkClasses({ tone: 'text', size: 'label' })}`}>
                  <Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" /> Tracked as a task
                </Link>
              ) : (
                <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}>Start remediation</Button>
              )
            )}
            {open && rights.edit && <Button size="sm" onClick={() => { unsaid('close'); setClosing(true); }}>Close</Button>}
            {open && rights.edit && (rights.accept ? (
              <Button variant="ghost" size="sm" onClick={() => { unsaid('accept'); setAccepting(true); }}>Accept risk</Button>
            ) : (
              <span className="inline-flex items-center gap-[4px] text-ds-label text-ds-fg-muted" title="Accepting a risk needs the right to accept risk">
                <Info aria-hidden className="h-[14px] w-[14px]" /> An approver must accept
              </span>
            ))}
            {open && rights.edit && !shared && (
              <Button variant="ghost" size="sm" leftIcon={<Send aria-hidden />} title="Ask the vendor for a plan to fix it" onClick={() => setSharing(true)}>Share</Button>
            )}
            {isSettled(f.status) && rights.edit && <Button size="sm" leftIcon={<RotateCcw aria-hidden />} onClick={() => { unsaid('reopen'); setReopening(true); }}>Reopen</Button>}
            <span className="ml-auto flex items-center gap-[4px]">
              <Button variant="ghost" size="sm" aria-expanded={expanded} leftIcon={expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />} onClick={onToggle}>Details</Button>
              {rights.remove && <IconButton label="Remove finding" onClick={() => { void askRemove(); }}><Trash2 aria-hidden /></IconButton>}
            </span>
          </>
        )}
      </div>

      {expanded && !removed && <Details f={f} rights={rights} onChanged={done} />}

      <AcceptDialog open={accepting} onClose={() => setAccepting(false)} finding={f} busy={accept.isPending} error={problem.accept} onAccept={(p) => { unsaid('accept'); accept.mutate(p); }} />
      <CloseDialog open={closing} onClose={() => setClosing(false)} finding={f} busy={close.isPending} error={problem.close} onCloseFinding={(note) => { unsaid('close'); close.mutate(note); }} />
      <ReopenDialog open={reopening} onClose={() => setReopening(false)} finding={f} busy={reopen.isPending} error={problem.reopen} onReopen={(why) => { unsaid('reopen'); reopen.mutate(why); }} />
      {sharing && <ShareFindingPanel finding={f} onClose={() => setSharing(false)} />}
      {confirmDialog}
    </Root>
  );
}

const SUB = 'flex items-center gap-[6px] text-ds-label font-[600] uppercase tracking-wide text-ds-fg-muted';

function Section({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-[6px] flex items-center justify-between gap-[8px]">
        <p className={SUB}>{icon} {title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** What was always under a finding: its remediation tasks, its risk acceptances and its evidence. */
function Details({ f, rights, onChanged }: { f: FindingRow; rights: Rights; onChanged: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const { data: detail, isError, error } = useQuery({
    queryKey: ['tpra-finding', f.id],
    queryFn: async () => (await tpraApi.getFinding(f.id)).data as FindingDetail,
  });
  const addRem = useReportedMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createRemediation(f.id, p),
    success: 'Remediation added',
    failure: 'Remediation not added',
    toast: 'success',
    invalidate: [['tpra-finding', f.id]],
    onError: (e) => setProblem(e),
    onSuccess: () => { onChanged(); setAdding(false); },
  });
  const updRem = useReportedMutation({
    mutationFn: ({ id, p }: { id: number; p: Record<string, unknown> }) => tpraApi.updateRemediation(id, p),
    failure: 'Remediation not saved',
    invalidate: [['tpra-finding', f.id]],
    onSuccess: onChanged,
  });
  const delRem = useReportedMutation({
    mutationFn: (id: number) => tpraApi.deleteRemediation(id),
    success: 'Remediation removed',
    failure: 'Remediation not removed',
    invalidate: [['tpra-finding', f.id]],
    onSuccess: onChanged,
  });
  const revoke = useReportedMutation({
    mutationFn: (id: number) => tpraApi.revokeAcceptance(id),
    success: 'Acceptance revoked',
    failure: 'Acceptance not revoked',
    invalidate: [['tpra-finding', f.id]],
    onSuccess: onChanged,
  });
  const askDelete = async (r: Remediation) => {
    if (await confirm({ title: 'Remove this remediation task?', message: 'The task leaves the finding, and its Task Management task goes with it.', confirmLabel: 'Remove task', tone: 'danger' })) delRem.mutate(r.id);
  };
  const askRevoke = async (a: Acceptance) => {
    if (await confirm({ title: 'Revoke this risk acceptance?', message: 'The finding is no longer accepted: it counts again.', confirmLabel: 'Revoke acceptance', tone: 'danger' })) revoke.mutate(a.id);
  };

  return (
    <div className="mt-[12px] flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      {isError && !detail && <Notice tone="danger" title="Couldn't load the details">{error instanceof Error ? 'Close this and open it again.' : 'Try again in a moment.'}</Notice>}
      <Section icon={<Wrench aria-hidden className="h-[14px] w-[14px]" />} title="Remediation" action={rights.edit ? <Button variant="link" size="sm" onClick={() => { setProblem(null); setAdding(true); }}>+ Add task</Button> : undefined}>
        {(detail?.remediations || []).length === 0 ? (
          <p className="text-ds-body text-ds-fg-muted">{detail ? 'No remediation tasks.' : 'Loading…'}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {detail!.remediations.map((r: Remediation) => (
              <li key={r.id} className="flex flex-wrap items-center gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface p-[8px]">
                <div className="min-w-0 flex-1 basis-[10rem]">
                  <p className="break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.title || 'Remediation'}</p>
                  <p className="text-ds-label text-ds-fg-muted">{r.treatment_type} · due {formatDate(r.due_date, { calendar: true })}</p>
                </div>
                {rights.edit ? (
                  <Select aria-label="Remediation status" className="w-[140px]" value={r.status} onChange={(e) => updRem.mutate({ id: r.id, p: { status: e.target.value, row_version: r.row_version } })}>
                    {['open', 'in_progress', 'completed', 'overdue'].map((s) => <option key={s} value={s}>{statusLabelOf(s)}</option>)}
                  </Select>
                ) : <span className="text-ds-label text-ds-fg-body">{statusLabelOf(r.status)}</span>}
                {rights.edit && <IconButton label="Remove remediation task" onClick={() => { void askDelete(r); }}><Trash2 aria-hidden /></IconButton>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<ShieldCheck aria-hidden className="h-[14px] w-[14px]" />} title="Risk acceptance">
        {(detail?.acceptances || []).length === 0 ? (
          <p className="text-ds-body text-ds-fg-muted">{detail ? 'No risk acceptances.' : 'Loading…'}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {detail!.acceptances.map((a: Acceptance) => (
              <li key={a.id} className="flex flex-wrap items-center gap-[8px] rounded-ds-control border border-ds-border bg-ds-info-soft p-[8px]">
                <div className="min-w-0 flex-1 basis-[10rem]">
                  <p className="break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{a.rationale || 'Accepted'}</p>
                  <p className="text-ds-label text-ds-fg-muted">{statusLabelOf(a.status)} · {a.expiry ? `runs to ${formatDate(a.expiry, { calendar: true })}` : 'no end date'}</p>
                </div>
                {rights.accept && a.status === 'active' && <Button variant="dangerOutline" size="sm" onClick={() => { void askRevoke(a); }}>Revoke</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="border-t border-ds-border pt-[12px]">
        <EvidencePanel assessmentId={f.assessment_id} findingId={f.id} title="Evidence" compact />
      </div>
      <AddRemediationPanel open={adding} onClose={() => setAdding(false)} onSubmit={(p) => { setProblem(null); addRem.mutate(p); }} busy={addRem.isPending} error={problem} />
      {confirmDialog}
    </div>
  );
}

const statusLabelOf = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
