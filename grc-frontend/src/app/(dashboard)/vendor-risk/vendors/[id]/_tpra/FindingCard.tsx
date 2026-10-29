'use client';

// One finding as Verity draws it: severity, title, the Blocking badge, the detail, "Source · Treatment · raised · due", its status, the
// risk-register link, the violet box of an accepted risk, and what can be done to it: an owner, Start remediation, Close, Accept risk,
// Reopen. Shared by the vendor record's Findings tab and the lifecycle's Findings stage. Under "Details", what was always here:
// remediation tasks, risk acceptances and evidence; Share with the vendor; remove and restore.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, ArrowUpRight, Check, ChevronDown, ChevronRight, Info, Loader2, RotateCcw, Send, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { PersonChip, SeverityChip, StatusPill, TONE, fmt, tones } from '@/app/(dashboard)/vendor-risk/_ui';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi } from '@/lib/api';
import { findingsApi, refreshFindings, type FindingRow } from '../../../_lib/findingsApi';
import { dueOf, isOpen, isSettled, sourceLabel, treatmentLabel } from '../../../_lib/findingCardModel';
import { REQUEST_STATUS, type SupplierRequest } from '../../../_lib/requestsApi';
import { AcceptDialog, AddRemediationPanel, CloseDialog, ReopenDialog, ShareFindingPanel } from './FindingDialogs';
import EvidencePanel from './EvidencePanel';
import { DOMAIN_LABELS } from './constants';
import type { Acceptance, FindingDetail, Remediation } from './types';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const SM = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 text-[13px] font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const GHOST = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[#0f766e] hover:bg-[#f0fdfa] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const CHIP = 'inline-flex items-center gap-1 rounded-md border border-[#d5dbe1] bg-[#f3f6f8] px-1.5 py-0.5 text-[11px] font-medium leading-4 text-[#586472]';

export interface Rights { edit: boolean; accept: boolean; remove: boolean }

export default function FindingCard({
  finding: f, people, rights, shared, expanded, onToggle, highlight = false, onChanged,
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
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const [accepting, setAccepting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [sharing, setSharing] = useState(false);

  const done = () => { refreshFindings(qc); onChanged?.(); };
  const failed = (title: string) => (e: unknown) => toast({ type: 'error', title, message: apiErrorText(e, 'Try again.') });

  const owner = useMutation({
    mutationFn: (id: number | null) => findingsApi.setOwner(f.id, id),
    onSuccess: () => { done(); toast({ type: 'success', title: 'Owner saved' }); },
    onError: failed('Owner not saved'),
  });
  const start = useMutation({
    mutationFn: () => findingsApi.startRemediation(f.id),
    onSuccess: (res) => { done(); toast({ type: 'success', title: res.data.owner?.name ? `Remediation task opened for ${res.data.owner.name}` : 'Remediation task opened' }); },
    onError: failed('Remediation not started'),
  });
  const accept = useMutation({
    mutationFn: (p: { rationale: string; expiry?: string }) => tpraApi.createAcceptance(f.id, p),
    onSuccess: () => { setAccepting(false); done(); toast({ type: 'success', title: 'Risk accepted' }); },
    onError: failed('Not accepted'),
  });
  const close = useMutation({
    mutationFn: (note: string) => findingsApi.close(f.id, note),
    onSuccess: () => { setClosing(false); done(); toast({ type: 'success', title: 'Finding closed' }); },
    onError: failed('Not closed'),
  });
  const reopen = useMutation({
    mutationFn: (reason: string) => findingsApi.reopen(f.id, reason),
    onSuccess: () => { setReopening(false); done(); toast({ type: 'success', title: 'Finding reopened' }); },
    onError: failed('Not reopened'),
  });
  const promote = useMutation({
    mutationFn: () => tpraApi.promoteFindingToRegister(f.id),
    onSuccess: (res) => {
      done();
      const riskId = (res?.data as { risk_id?: number })?.risk_id;
      toast({
        type: 'success', title: 'Moved to Risk Register',
        message: riskId ? 'Opening it so you can complete the risk details.' : 'Created a vendor-sourced risk in the ERM register.',
      });
      // Land the user on THIS risk in the ERM register to fill the required fields.
      if (riskId) router.push(`/erm/risks/list?edit=${riskId}`);
    },
    onError: failed('Promote failed'),
  });
  const remove = useMutation({
    mutationFn: () => tpraApi.deleteFinding(f.id),
    onSuccess: () => { done(); toast({ type: 'success', title: 'Finding removed' }); },
    onError: failed('Delete failed'),
  });
  const restore = useMutation({
    mutationFn: () => tpraApi.restoreFinding(f.id),
    onSuccess: () => { done(); toast({ type: 'success', title: 'Finding restored' }); },
    onError: failed('Not restored'),
  });

  const removed = !!f.deleted_at;
  const open = isOpen(f.status);
  const due = dueOf(f);
  const story = [sourceLabel(f.source), treatmentLabel(f.treatment), `raised ${fmt.date(f.created_at)}`].filter(Boolean);
  const named = f.owner?.name ?? people.find((p) => p.id === f.owner_id)?.name ?? null;

  return (
    <li id={`tpra-finding-${f.id}`} className={`scroll-mt-4 list-none py-3.5 ${removed ? 'opacity-60' : ''} ${highlight ? 'rounded-lg bg-[#f0fdfa] px-3 ring-1 ring-[#99d5cf]' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={f.severity} />
            <span className="text-[14px] font-semibold leading-5 text-[#1f2933]">{f.title || 'Untitled finding'}</span>
            {f.is_blocking && (
              <span title="Blocks approval until closed or accepted" className="rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-4"
                style={{ background: TONE.danger.tint, borderColor: TONE.danger.border, color: TONE.danger.text }}>Blocking</span>
            )}
            {f.is_critical_control_fail && (
              <span className={CHIP} title="A failed critical control"><AlertOctagon aria-hidden className="h-3 w-3" /> Critical control</span>
            )}
            <span className={CHIP}>{DOMAIN_LABELS[f.domain] || f.domain}</span>
            {f.engagement?.name && <span className={CHIP} title="The engagement this is about">{f.engagement.name}</span>}
            {f.linked_issue_id && (
              <Link href={`/issues/${f.linked_issue_id}`} title="Tracked as an Issue: one owner, SLA and workflow"
                className={`${CHIP} hover:bg-[#e8edf1] ${FOCUS}`}><ArrowUpRight aria-hidden className="h-3 w-3" /> Issue #{f.linked_issue_id}</Link>
            )}
            {shared && (
              <span title="Shared with the vendor: see Requests & messages" className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${REQUEST_STATUS[shared.status].tone}`}>
                <Send aria-hidden className="h-3 w-3" /> {shared.status === 'submitted' ? 'Vendor answered' : 'With vendor'}
              </span>
            )}
          </p>
          {f.description && <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-[#586472]">{f.description}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-4 text-[#64707e]">
            {story.map((part, i) => <span key={part}>{i > 0 && <span aria-hidden className="mr-2">·</span>}{part}</span>)}
            {due.text && (
              <span className={due.overdue ? 'font-semibold text-[#c01741]' : undefined}><span aria-hidden className="mr-2 font-normal text-[#64707e]">·</span>{due.text}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {f.linked_risk_id ? (
            <Link href={`/erm/risks/list?edit=${f.linked_risk_id}`} title="Open this risk in the Risk Register"
              className={`inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-[#0f766e] hover:underline ${FOCUS}`}>
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /> In risk register
            </Link>
          ) : rights.edit && !removed ? (
            <button type="button" className={GHOST} disabled={promote.isPending} onClick={() => promote.mutate()}
              title="Move this finding into the Risk Register as a vendor-sourced risk">
              {promote.isPending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />} Promote to risk
            </button>
          ) : null}
          <StatusPill tone={tones.finding(f.status)}>{fmt.status(f.status)}</StatusPill>
        </div>
      </div>

      {f.status === 'accepted' && (
        <div className="mt-2 rounded-lg border p-3" style={{ background: TONE.pending.tint, borderColor: TONE.pending.border }}>
          <p className="text-[13px] font-semibold" style={{ color: TONE.pending.text }}>
            {f.accepted_until ? `Accepted until ${fmt.date(f.accepted_until)}` : 'Accepted, with no end date'}
          </p>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-[#586472]">{f.acceptance?.rationale || 'No rationale recorded.'}</p>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {removed ? (
          rights.edit && (
            <button type="button" className={SM} disabled={restore.isPending} onClick={() => restore.mutate()}>
              <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Restore
            </button>
          )
        ) : (
          <>
            {open && rights.edit ? (
              <select aria-label={`Owner of ${f.title || 'this finding'}`} value={f.owner_id ?? ''} disabled={owner.isPending}
                onChange={(e) => owner.mutate(e.target.value ? Number(e.target.value) : null)}
                className={`h-8 w-52 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2 text-[13px] text-[#1f2933] ${FOCUS}`}>
                <option value="">Assign an owner</option>
                {f.owner_id && !people.some((p) => p.id === f.owner_id) && <option value={f.owner_id}>{named || `User ${f.owner_id}`}</option>}
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (named || open) ? (
              <PersonChip name={named} size="sm" />
            ) : null}
            {open && rights.edit && (
              f.task_id ? (
                <Link href={`/tasks/${f.task_id}`} title={f.task?.status ? `The task is ${f.task.status.toLowerCase()}` : 'Open the task'}
                  className={`inline-flex items-center gap-1.5 rounded-md text-[13px] text-[#26323d] hover:underline ${FOCUS}`}>
                  <Check aria-hidden className="h-3.5 w-3.5 shrink-0" style={{ color: TONE.success.dot }} /> Tracked as a task
                </Link>
              ) : (
                <button type="button" className={SM} disabled={start.isPending} onClick={() => start.mutate()}>
                  {start.isPending && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />} Start remediation
                </button>
              )
            )}
            {open && rights.edit && <button type="button" className={SM} onClick={() => setClosing(true)}>Close</button>}
            {open && rights.edit && (rights.accept ? (
              <button type="button" className={GHOST} onClick={() => setAccepting(true)}>Accept risk</button>
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] text-[#64707e]" title="Accepting a risk needs the right to accept risk">
                <Info aria-hidden className="h-3.5 w-3.5" /> Approver must accept
              </span>
            ))}
            {open && rights.edit && !shared && (
              <button type="button" className={GHOST} onClick={() => setSharing(true)} title="Ask the vendor for a plan to fix it">
                <Send aria-hidden className="h-3.5 w-3.5" /> Share
              </button>
            )}
            {isSettled(f.status) && rights.edit && (
              <button type="button" className={SM} onClick={() => setReopening(true)}><RotateCcw aria-hidden className="h-3.5 w-3.5" /> Reopen</button>
            )}
            <span className="ml-auto flex items-center gap-1">
              <button type="button" className={GHOST} aria-expanded={expanded} onClick={onToggle}>
                {expanded ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />} Details
              </button>
              {rights.remove && (
                <button type="button" aria-label="Remove finding" title="Remove finding" disabled={remove.isPending} onClick={() => remove.mutate()}
                  className={`grid h-8 w-8 place-items-center rounded-lg text-[#64707e] hover:bg-[#fef3f2] hover:text-[#b42318] ${FOCUS}`}>
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </>
        )}
      </div>

      {expanded && !removed && <Details f={f} rights={rights} onChanged={done} />}

      <AcceptDialog open={accepting} onClose={() => setAccepting(false)} finding={f} busy={accept.isPending} onAccept={(p) => accept.mutate(p)} />
      <CloseDialog open={closing} onClose={() => setClosing(false)} finding={f} busy={close.isPending} onCloseFinding={(note) => close.mutate(note)} />
      <ReopenDialog open={reopening} onClose={() => setReopening(false)} finding={f} busy={reopen.isPending} onReopen={(why) => reopen.mutate(why)} />
      {sharing && <ShareFindingPanel finding={f} onClose={() => setSharing(false)} />}
    </li>
  );
}

/** What was always under a finding: its remediation tasks, its risk acceptances and its evidence. */
function Details({ f, rights, onChanged }: { f: FindingRow; rights: Rights; onChanged: () => void }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const { data: detail } = useQuery({
    queryKey: ['tpra-finding', f.id],
    queryFn: async () => (await tpraApi.getFinding(f.id)).data as FindingDetail,
  });
  const failed = (title: string) => (e: unknown) => toast({ type: 'error', title, message: apiErrorText(e, 'Try again.') });
  const addRem = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createRemediation(f.id, p),
    onSuccess: () => { onChanged(); setAdding(false); toast({ type: 'success', title: 'Remediation added' }); },
    onError: failed('Failed'),
  });
  const updRem = useMutation({
    mutationFn: ({ id, p }: { id: number; p: Record<string, unknown> }) => tpraApi.updateRemediation(id, p),
    onSuccess: onChanged,
    onError: failed('Not saved'),
  });
  const delRem = useMutation({ mutationFn: (id: number) => tpraApi.deleteRemediation(id), onSuccess: onChanged, onError: failed('Not removed') });
  const revoke = useMutation({ mutationFn: (id: number) => tpraApi.revokeAcceptance(id), onSuccess: onChanged, onError: failed('Not revoked') });

  const head = 'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#586472]';
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-[#e1e6eb] bg-[#fbfcfc] p-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className={head}><Wrench aria-hidden className="h-3.5 w-3.5" /> Remediation</p>
          {rights.edit && <button type="button" onClick={() => setAdding(true)} className="text-[12px] font-medium text-[#0f766e] hover:underline">+ Add task</button>}
        </div>
        {(detail?.remediations || []).length === 0 ? (
          <p className="text-[13px] text-[#64707e]">No remediation tasks.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail!.remediations.map((r: Remediation) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-[#d5dbe1] bg-[#fff] p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#1f2933]">{r.title || 'Remediation'}</p>
                  <p className="text-[12px] text-[#64707e]">{r.treatment_type} · due {fmt.date(r.due_date)}</p>
                </div>
                {rights.edit ? (
                  <select aria-label="Remediation status" value={r.status}
                    onChange={(e) => updRem.mutate({ id: r.id, p: { status: e.target.value, row_version: r.row_version } })}
                    className={`h-8 rounded-lg border border-[#c3ccd5] bg-[#fff] px-1.5 text-[12px] ${FOCUS}`}>
                    {['open', 'in_progress', 'completed', 'overdue'].map((s) => <option key={s} value={s}>{fmt.status(s)}</option>)}
                  </select>
                ) : <span className="text-[12px] text-[#586472]">{fmt.status(r.status)}</span>}
                {rights.edit && (
                  <button type="button" onClick={() => delRem.mutate(r.id)} aria-label="Delete remediation"
                    className={`grid h-8 w-8 place-items-center rounded-lg text-[#64707e] hover:bg-[#fef3f2] hover:text-[#b42318] ${FOCUS}`}>
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className={`${head} mb-1.5`}><ShieldCheck aria-hidden className="h-3.5 w-3.5" /> Risk acceptance</p>
        {(detail?.acceptances || []).length === 0 ? (
          <p className="text-[13px] text-[#64707e]">No risk acceptances.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail!.acceptances.map((a: Acceptance) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg border p-2" style={{ background: TONE.pending.tint, borderColor: TONE.pending.border }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[#1f2933]">{a.rationale || 'Accepted'}</p>
                  <p className="text-[12px] text-[#586472]">{fmt.status(a.status)} · {a.expiry ? `runs to ${fmt.date(a.expiry)}` : 'no end date'}</p>
                </div>
                {rights.accept && a.status === 'active' && (
                  <button type="button" onClick={() => revoke.mutate(a.id)} className="text-[12px] font-medium text-[#b42318] hover:underline">Revoke</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[#e1e6eb] pt-3">
        <EvidencePanel assessmentId={f.assessment_id} findingId={f.id} title="Evidence" compact />
      </div>
      <AddRemediationPanel open={adding} onClose={() => setAdding(false)} onSubmit={(p) => addRem.mutate(p)} busy={addRem.isPending} />
    </div>
  );
}
