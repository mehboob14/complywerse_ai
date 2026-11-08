'use client';

// A finding's details, in a panel over the register (the old page was a separate screen whose data route did not exist, so it never loaded): what it is, how serious, where it came from (the unit
// and the campaign, both links), its owner and fix-by day, what to do, and what it is tied to. The three things a person does to a finding are here, each with feedback and a plain failure:
// move it on (start, fixed, close, accept, reopen), link it to a risk or a control chosen from a searchable list (the old pages asked to TYPE a number and posted a body the server ignores),
// and make a mitigation action from it (which needs a risk first, and says so). Changing the owner, the fix-by day or the severity is a small sheet.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ClipboardPlus, Link2, Pencil } from 'lucide-react';
import apiClient, { risksApi, rcsaApi } from '@/lib/api';
import {
  Button, ClampedText, Combobox, ErrorState, Fact, FactList, FormError, FormField, Menu, SidePanel, Select, Sheet, StatusPill, TextInput, Textarea, useReportedMutation, type MenuItem,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { findingSeverity, findingStatus, findingType, optionsOf } from '@/lib/statuses/rcsa';
import { actionBlock, isLate, movedWords, nextStep, otherMoves, type FindingRow, type LinkKind } from '@/lib/rcsa/findingsModel';
import { KEYS, peopleOptions, usePeople } from '../../_parts/rcsaData';

const refresh = [KEYS.findings, KEYS.work, KEYS.summary] as const;

function LinkSheet({ finding, kind, onClose }: { finding: FindingRow; kind: Exclude<LinkKind, 'action'>; onClose: () => void }) {
  const [value, setValue] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const risk = kind === 'risk';
  const options = useQuery({
    queryKey: ['rcsa', 'link-options', kind],
    queryFn: async () => (risk
      ? ((await risksApi.getAll()).data as unknown as Array<{ id: number; title: string; risk_id?: string }>).map((r) => ({ value: String(r.id), label: r.title, description: r.risk_id }))
      : ((await apiClient.get('/erm/internal-controls', { params: { limit: 1000 } })).data as Array<{ id: number; name: string; control_id?: string }>).map((c) => ({ value: String(c.id), label: c.name, description: c.control_id }))),
    staleTime: 60_000,
  });
  const link = useReportedMutation({
    mutationFn: async () => { if (risk) await rcsaApi.linkFindingToRisk(finding.id, Number(value)); else await rcsaApi.linkFindingToControl(finding.id, Number(value)); },
    success: risk ? 'Linked to the risk' : 'Linked to the control',
    failure: risk ? "The risk wasn't linked" : "The control wasn't linked",
    toast: 'success',
    invalidate: [...refresh],
    onSuccess: onClose,
    onError: (e) => setProblem(e),
  });
  const word = risk ? 'risk' : 'control';
  return (
    <Sheet
      open onClose={onClose} title={risk ? 'Link a risk' : 'Link a control'} subtitle={finding.title} width="md" dirty={value !== null && !link.isPending}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={link.isPending} disabled={!value} onClick={() => { setProblem(null); link.mutate(); }}>{`Link ${word}`}</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        <FormError title={`The ${word} wasn't linked`} error={problem} onRetry={() => link.mutate()} />
        {options.isError ? <ErrorState compact title={`Couldn't load the ${word}s`} message={errorMessage(options.error)} onRetry={() => { void options.refetch(); }} /> : (
          <FormField label={risk ? 'Risk' : 'Control'} required hint={risk ? 'Search the risk register by title.' : 'Search the internal controls by name.'}>
            <Combobox label={risk ? 'Risk' : 'Control'} options={options.data ?? []} value={value} onChange={setValue} searchable placeholder={options.isLoading ? 'Loading' : `Choose a ${word}`} disabled={options.isLoading} />
          </FormField>
        )}
      </div>
    </Sheet>
  );
}

function EditSheet({ finding, onClose }: { finding: FindingRow; onClose: () => void }) {
  const [severity, setSeverity] = useState(finding.severity);
  const [type, setType] = useState(finding.finding_type);
  const [description, setDescription] = useState(finding.description ?? '');
  const [due, setDue] = useState((finding.remediation_due_date ?? '').slice(0, 10));
  const [owner, setOwner] = useState<string | null>(finding.remediation_owner_id ? String(finding.remediation_owner_id) : null);
  const [problem, setProblem] = useState<unknown>(null);
  const people = usePeople(true);
  const dirty = severity !== finding.severity || type !== finding.finding_type || description !== (finding.description ?? '') || due !== (finding.remediation_due_date ?? '').slice(0, 10) || owner !== (finding.remediation_owner_id ? String(finding.remediation_owner_id) : null);
  const save = useReportedMutation({
    mutationFn: () => rcsaApi.updateFinding(finding.id, { severity, finding_type: type, description: description.trim() || null, remediation_due_date: due ? `${due}T00:00:00` : null, remediation_owner_id: owner ? Number(owner) : null }),
    success: 'Finding saved',
    failure: "The finding wasn't saved",
    toast: 'success',
    invalidate: [...refresh],
    onSuccess: onClose,
    onError: (e) => setProblem(e),
  });
  return (
    <Sheet
      open onClose={onClose} title="Edit finding" subtitle={finding.title} width="md" dirty={dirty && !save.isPending}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => { setProblem(null); save.mutate(); }}>Save finding</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        <FormError title="The finding wasn't saved" error={problem} onRetry={() => save.mutate()} />
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Kind"><Select value={type} onChange={(e) => setType(e.target.value)}>{optionsOf(findingType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          <FormField label="How serious"><Select value={severity} onChange={(e) => setSeverity(e.target.value)}>{optionsOf(findingSeverity).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
        </div>
        <FormField label="What to do about it" optional><Textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Fix by" optional><TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
          <FormField label="Owner" optional hint={people.isError ? 'People could not be loaded; the owner stays as it is.' : undefined}>
            <Combobox label="Owner" options={peopleOptions(people.data)} value={owner} onChange={setOwner} placeholder="Not set" clearable disabled={people.isError} />
          </FormField>
        </div>
      </div>
    </Sheet>
  );
}

export function FindingPanel({ finding, onClose }: { finding: FindingRow | null; onClose: () => void }) {
  const [sheet, setSheet] = useState<'risk' | 'control' | 'edit' | null>(null);
  const move = useReportedMutation({
    mutationFn: ({ f, to }: { f: FindingRow; to: string }) => rcsaApi.updateFinding(f.id, { status: to }),
    success: (_, v) => movedWords(v.to, v.f.title),
    failure: "The finding wasn't updated",
    invalidate: [...refresh],
  });
  const action = useReportedMutation({
    mutationFn: (f: FindingRow) => rcsaApi.createFindingAction(f.id),
    success: () => ({ title: 'Mitigation action created', message: 'It is open under the linked risk.' }),
    failure: "The action wasn't created",
    retryable: false,
    invalidate: [...refresh],
  });
  const f = finding;
  const step = f ? nextStep(f.status) : null;
  const block = f ? actionBlock(f) : null;
  const late = f ? isLate(f) : false;
  const menu: MenuItem[] = f ? [
    ...otherMoves(f.status).map((m): MenuItem => ({ key: m.to, label: m.label, onSelect: () => move.mutate({ f, to: m.to }) })),
    { key: 'edit', label: 'Edit finding', icon: Pencil, section: 'Finding', onSelect: () => setSheet('edit') },
  ] : [];
  return (
    <>
      <SidePanel
        open={!!f}
        onClose={onClose}
        title={<span dir="auto" className="line-clamp-3 break-words" title={f?.title}>{f?.title}</span>}
        subtitle={f ? [f.business_unit_name, f.campaign_name].filter(Boolean).join(' · ') : undefined}
        dockFrom={Infinity}
        width="md"
        actions={f ? <Menu label="More" iconOnly items={menu} /> : undefined}
        footer={f && step ? <Button variant="primary" loading={move.isPending} onClick={() => move.mutate({ f, to: step.to })}>{step.label}</Button> : undefined}
      >
        {f && (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill {...statusPill(findingStatus, f.status)} />
              <StatusPill {...statusPill(findingSeverity, f.severity)} />
              <StatusPill tone="neutral" label={statusPill(findingType, f.finding_type).label} />
              {late && <StatusPill tone="danger" label="Late" />}
            </div>
            {f.description ? <ClampedText text={f.description} lines={5} /> : <p className="text-ds-body text-ds-fg-muted">No description.</p>}
            {f.ai_recommendation && (
              <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
                <p className="text-ds-label font-[600] text-ds-fg">Suggested by AI</p>
                <ClampedText text={f.ai_recommendation} lines={4} className="mt-[4px]" />
              </div>
            )}
            <FactList min={140}>
              <Fact label="Owner" empty="Unassigned">{f.remediation_owner_name}</Fact>
              <Fact label="Fix by" empty="Not set">{f.remediation_due_date ? formatDate(f.remediation_due_date, { calendar: true }) : null}</Fact>
              <Fact label="Raised">{formatDate(f.created_at)}</Fact>
              {f.closed_at && <Fact label="Closed">{formatDate(f.closed_at)}</Fact>}
              <Fact label="Unit">
                <a href={`/erm/rcsa/assessments/${f.assessment_id}`} className="inline-flex min-h-ds-control items-center gap-[4px] text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                  {f.business_unit_name || 'Open the unit'}<ArrowUpRight aria-hidden className="h-[14px] w-[14px]" />
                </a>
              </Fact>
              <Fact label="Campaign">{f.campaign_id ? <a href={`/erm/rcsa/campaigns/${f.campaign_id}`} className="inline-flex min-h-ds-control items-center text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{f.campaign_name}</a> : null}</Fact>
            </FactList>

            <section aria-label="Links" className="flex flex-col gap-[8px] border-t border-ds-border pt-[12px]">
              <h3 className="!text-ds-body !font-[600] !text-ds-fg">Tied to</h3>
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className="min-w-[72px] text-ds-label text-ds-fg-muted">Risk</span>
                {f.linked_risk_id ? <a href={`/erm/risks/${f.linked_risk_id}`} className="min-w-0 flex-1 text-ds-body text-ds-primary-text underline-offset-2 hover:underline [overflow-wrap:anywhere]">{f.linked_risk_title || 'Open the risk'}</a> : <span className="min-w-0 flex-1 text-ds-body text-ds-fg-muted">Not linked</span>}
                <Button size="sm" leftIcon={<Link2 aria-hidden />} onClick={() => setSheet('risk')}>{f.linked_risk_id ? 'Change' : 'Link a risk'}</Button>
              </div>
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className="min-w-[72px] text-ds-label text-ds-fg-muted">Control</span>
                <span className={`min-w-0 flex-1 text-ds-body [overflow-wrap:anywhere] ${f.linked_internal_control_id ? 'text-ds-fg' : 'text-ds-fg-muted'}`}>{f.linked_internal_control_id ? f.linked_control_name || 'Linked' : 'Not linked'}</span>
                <Button size="sm" leftIcon={<Link2 aria-hidden />} onClick={() => setSheet('control')}>{f.linked_internal_control_id ? 'Change' : 'Link a control'}</Button>
              </div>
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className="min-w-[72px] text-ds-label text-ds-fg-muted">Action</span>
                <span className={`min-w-0 flex-1 text-ds-body [overflow-wrap:anywhere] ${f.linked_mitigation_action_id ? 'text-ds-fg' : 'text-ds-fg-muted'}`}>{f.linked_mitigation_action_id ? f.linked_action_title || 'Created' : block ?? 'No action yet'}</span>
                {!f.linked_mitigation_action_id && <Button size="sm" leftIcon={<ClipboardPlus aria-hidden />} loading={action.isPending} disabled={!!block} title={block ?? undefined} onClick={() => action.mutate(f)}>Create an action</Button>}
              </div>
            </section>
          </div>
        )}
      </SidePanel>
      {f && sheet === 'risk' && <LinkSheet finding={f} kind="risk" onClose={() => setSheet(null)} />}
      {f && sheet === 'control' && <LinkSheet finding={f} kind="control" onClose={() => setSheet(null)} />}
      {f && sheet === 'edit' && <EditSheet finding={f} onClose={() => setSheet(null)} />}
    </>
  );
}
