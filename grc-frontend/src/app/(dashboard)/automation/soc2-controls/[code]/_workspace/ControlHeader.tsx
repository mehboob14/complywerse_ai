'use client';

// The head of a control: its code and name, its status, who owns it, the ONE next step, and the actions on the whole control (Run tests; for a control the organisation wrote: Edit, its
// life-cycle step and Retire). Run tests reports how it went; every step that cannot be undone asks first; a button the server would refuse is drawn off, with the reason.
import { useRouter } from 'next/navigation';
import { Check, FileEdit, Play, Send, Trash2, X } from 'lucide-react';
import { Button, Menu, Notice, StatusPill, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { PageHeader } from '@/components/ui';
import { scfApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { controlLifecycle, controlStatus } from '@/lib/statuses/controls';
import { CodeChip } from './parts';
import { OwnershipBar } from './OwnershipBar';
import { applicabilityView } from './applicabilityModel';
import { nextStep, testOverdue, type NextStep } from './workspaceModel';
import { useAssurance } from './workspaceData';
import { useWorkspace } from './workspaceContext';

export function useNextStep(): NextStep | null {
  const { code, d, rights, me } = useWorkspace();
  const a = useAssurance(code);
  const app = applicabilityView(d.applicability, me, { frameworks: rights.frameworks });
  const wi = a.data?.work_item;
  const r = a.data?.readiness;
  return nextStep({
    overall_status: d.overall_status || 'manual',
    checks_count: d.checks_count ?? 0,
    applicable: app.state !== 'not_applicable',
    has_owner: d.owner_user_id != null,
    pending_request: app.state === 'pending',
    can_decide: app.canDecide,
    can_assign: rights.assign,
    can_run: rights.scan && (d.checks ?? []).some((c) => c.id != null),
    test_overdue: wi ? testOverdue(wi.next_test_date, new Date()) : false,
    tested: wi ? !!(wi.last_tested_at || wi.design_effectiveness || wi.operating_effectiveness) : true,      // unknown while it loads: do not claim "not tested"
    evidence_missing: r?.missing ?? 0,
    evidence_failing: r?.failing ?? 0,
  });
}

export function ControlHeader() {
  const router = useRouter();
  const next = useNextStep();
  const { code, d, isCustom, rights, why, runTests, running, editControl, go, decide, refresh } = useWorkspace();
  const { confirm, confirmDialog } = useConfirm();
  const lifecycle = d.profile?.lifecycle_status || 'draft';
  const checks = (d.checks ?? []).filter((c) => c.id != null);
  const cadence = d.conformity_cadence || d.implementation?.conformity_cadence;

  const step = useReportedMutation({
    mutationFn: (action: string) => scfApi.setCustomControlLifecycle(code, { action }),
    success: (_d, action) => ({ title: { submit: 'Sent for approval', approve: 'Control approved', reject: 'Control rejected', deactivate: 'Control deactivated' }[action] ?? 'Status changed', message: 'The control’s register status is updated.' }),
    failure: "Couldn't change the status",
    onSuccess: () => { void refresh(); },
  });
  const retire = useReportedMutation({
    mutationFn: () => scfApi.retireCustomControl(code),
    success: { title: 'Control retired', message: 'It has left the active library.' },
    failure: "Couldn't retire the control",
    onSuccess: () => { void refresh(); router.push('/automation/soc2-controls'); },
  });

  const canStep = rights.libraryEdit;
  const canRule = rights.libraryEdit || rights.signOff;
  const ask = async (action: string, title: string, message: string, confirmLabel: string) => {
    if (await confirm({ title, message, confirmLabel, tone: 'danger' })) step.mutate(action);
  };
  const items: MenuItem[] = isCustom ? [
    ...(lifecycle === 'pending_approval' ? [
      { key: 'approve', label: 'Approve this control', icon: Check, disabled: !canRule, reason: canRule ? undefined : why('libraryEdit'), onSelect: () => step.mutate('approve') },
      { key: 'reject', label: 'Reject this control', icon: X, disabled: !canRule, reason: canRule ? undefined : why('libraryEdit'), onSelect: () => { void ask('reject', 'Reject this control?', 'It goes back to its author as rejected. Whoever submitted a control cannot approve it.', 'Reject'); } },
    ] : lifecycle === 'active' ? [
      { key: 'deactivate', label: 'Deactivate', icon: X, disabled: !canStep, reason: why('libraryEdit'), onSelect: () => { void ask('deactivate', 'Deactivate this control?', 'It stops counting in your library until it is approved again.', 'Deactivate'); } },
    ] : [
      { key: 'submit', label: 'Send for approval', icon: Send, disabled: !canStep, reason: why('libraryEdit'), onSelect: () => step.mutate('submit') },
    ]),
    { key: 'retire', label: 'Retire this control', icon: Trash2, danger: true, disabled: !canStep, reason: why('libraryEdit'), onSelect: () => { void confirm({ title: 'Retire this control?', message: `${code} leaves the active library. Tests and evidence already recorded stay as the record.`, confirmLabel: 'Retire', tone: 'danger' }).then((yes) => { if (yes) retire.mutate(); }); } },
  ] : [];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={d.title}
        back={{ href: '/automation/soc2-controls', label: 'Back to controls' }}
        meta={[d.category, d.sub_type, cadence ? `Reassess ${String(cadence).toLowerCase()}` : null].filter(Boolean).join(' · ') || undefined}
        chips={(
          <>
            <CodeChip code={d.control_id} />
            <StatusPill {...statusPill(controlStatus, d.overall_status || 'manual')} />
            {d.is_material && <span title="The Secure Controls Framework weights this as a material control"><StatusPill tone="neutral" label="Material" /></span>}
            {isCustom && <StatusPill tone="neutral" label="Custom" />}
            {isCustom && <StatusPill {...statusPill(controlLifecycle, lifecycle)} />}
          </>
        )}
        actions={(
          <>
            {checks.length > 0 && <Button variant="primary" leftIcon={<Play aria-hidden />} loading={running} disabled={!rights.scan} title={why('scan') ?? 'Run every automated test linked to this control'} onClick={runTests}>Run tests</Button>}
            {isCustom && <Button leftIcon={<FileEdit aria-hidden />} disabled={!rights.libraryEdit} title={why('libraryEdit')} onClick={editControl}>Edit</Button>}
            {items.length > 0 && <Menu label="More actions" iconOnly items={items} />}
          </>
        )}
      />

      <section id="ws-people" aria-label="Who is responsible" className="rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
        <OwnershipBar
          code={code}
          scopeId={d.scope_id}
          ownerId={d.owner_user_id}
          reviewerId={d.reviewer_user_id}
          assignedIds={d.assigned_user_ids}
          canAssign={rights.assign}
          noRight={why('assign')}
          onSaved={() => { void refresh(); }}
        />
      </section>

      {next && (
        <Notice
          tone="info"
          title="Next step"
          action={next.action ? (
            <Button variant="primary" size="sm" onClick={() => {
              if ('act' in next.go) {
                if (next.go.act === 'decide') decide();
                else if (next.go.act === 'run') runTests();
                else document.querySelector<HTMLElement>('#ws-people button')?.focus();
              } else go(next.go.tab, next.go.section);
            }}>{next.action}</Button>
          ) : undefined}
        >
          {next.text}
        </Notice>
      )}
      {confirmDialog}
    </div>
  );
}
