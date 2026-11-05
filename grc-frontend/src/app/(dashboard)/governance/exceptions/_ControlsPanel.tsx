'use client';

// The compensating controls of an approved exception (D62), inside its Implementation card: "Not covered yet" (the potential risks no control covers) above the list,
// and each control with its state (planned / in place), what it covers (the risks by TITLE and the assets by NAME, never by number), its owner, its due day and its
// evidence (a link opens in a new tab; an item of the Evidence library is shown by name). The people asked to implement it (`impl.my_turn`, the server's flag) add, change
// and remove controls in a dialog and ask AI to suggest some (_assistReview.tsx: each suggestion is saved only when Add is pressed, as an AI-suggested control).
// The risks come from the same query as the Potential risks panel (one request). People and the Evidence library are read only once the dialog is open.
import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, Link2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { assetsApi, evidenceApi, policyExceptionApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { AnimatedModal } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, Combobox, ErrorState, FormField, IconButton, MultiSelect, Notice, PersonChip, SegmentedControl, SkeletonLines, StatusPill, Textarea, TextInput, useConfirm, useReportedMutation,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { AiBox, useAiRun } from './_assistReview';
import { implementationOpen } from './_approval';
import {
  assetNameMap, controlDue, controlFormTouched, controlInput, controlWord, coverNames, coverableRisks, currentRound, emptyControlForm, formOfControl, riskTitleMap, withChosen,
  type ControlForm, type EvidenceDraft,
} from './_riskText';
import { LIST_KEYS, controlsKey, risksKey, type AiControlsAnswer, type AssetLink, type CompensatingControl, type ControlInput, type ControlsAnswer, type ExceptionItem, type RisksAnswer } from './_types';

const CAPTION = 'text-ds-label text-ds-fg-muted';
const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body';
const LINK = 'inline-flex max-w-full items-center gap-[4px] rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

/** A caption and what it says, on one line (wrapping under the caption on a narrow screen). */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[8px] gap-y-[2px]">
      <span className={`${CAPTION} w-[56px] shrink-0`}>{label}</span>
      <span className="min-w-0 flex-1 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

const Chips = ({ names, label }: { names: string[]; label: string }) => (
  <ul aria-label={label} className="flex flex-wrap gap-[4px]">{names.map((n, i) => <li key={i} className={CHIP}><span className="truncate" title={n}>{n}</span></li>)}</ul>
);

/** A link opens in a new tab (only a web address is made a link: the server accepts nothing else, and this never trusts it); a library item opens its page there. */
function EvidenceLink({ ev }: { ev: CompensatingControl['evidence'][number] }) {
  const href = ev.kind === 'link' ? ev.url : `/evidence/${ev.evidence_id}`;
  if (ev.kind === 'link' && !/^https?:\/\//i.test(ev.url)) return <span>{ev.label}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      <span className="truncate">{ev.label}</span>
      <ExternalLink aria-hidden strokeWidth={1.75} className="h-[12px] w-[12px] shrink-0" />
    </a>
  );
}

function ControlItem({ control: c, risks, assets, onEdit, onRemove }: {
  control: CompensatingControl; risks: Record<number, string>; assets: Record<number, string>; onEdit: () => void; onRemove: () => void;
}) {
  const word = controlWord(c.status);
  const covers = coverNames(c, risks, assets);
  const due = controlDue(c);
  return (
    <li className="flex flex-col gap-[6px] rounded-ds-card bg-ds-surface-subtle p-[10px]">
      <div className="flex flex-wrap items-start justify-between gap-x-[8px] gap-y-[4px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
            <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{c.title}</span>
            <StatusPill size="sm" {...word} />
            {c.source === 'ai' && <span className={CHIP}>AI-suggested</span>}
          </div>
        </div>
        {c.can_edit && (
          <span className="flex shrink-0 items-center">
            <IconButton label={`Edit control: ${truncate(c.title, 50).text}`} onClick={onEdit}><Pencil aria-hidden /></IconButton>
            <IconButton label={`Remove control: ${truncate(c.title, 50).text}`} onClick={onRemove}><Trash2 aria-hidden /></IconButton>
          </span>
        )}
      </div>
      {c.description && <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{c.description}</p>}
      {covers.risks.length > 0 && <Line label="Risks"><Chips names={covers.risks} label="Potential risks covered" /></Line>}
      {covers.assets.length > 0 && <Line label="Assets"><Chips names={covers.assets} label="Assets covered" /></Line>}
      {(c.owner || due) && (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[2px]">
          {c.owner && <span className="inline-flex min-w-0 items-center gap-[8px]"><span className={CAPTION}>Owner</span><PersonChip name={c.owner.name} /></span>}
          {due && <span className={CAPTION}>{`Due ${due}`}</span>}
        </div>
      )}
      {c.evidence.length > 0 && (
        <Line label="Evidence">
          <ul aria-label="Evidence" className="flex flex-wrap gap-x-[12px] gap-y-[2px]">{c.evidence.map((ev, i) => <li key={i} className="min-w-0"><EvidenceLink ev={ev} /></li>)}</ul>
        </Line>
      )}
    </li>
  );
}

/** Add or change a control: what it is, what it covers, who owns it, by when, whether it is in place, and its evidence. */
function ControlDialog({ exception, control, risks, riskNames, assets, onClose }: {
  exception: ExceptionItem; control: CompensatingControl | null; risks: Array<{ value: string; label: string }>; riskNames: Record<string, string>; assets: AssetLink[]; onClose: () => void;
}) {
  const [initial] = useState<ControlForm>(() => (control ? formOfControl(control) : emptyControlForm()));
  const [f, setF] = useState<ControlForm>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<ControlForm>) => setF((x) => ({ ...x, ...patch }));
  const people = useQuery({
    queryKey: ['assets-tenant-users'],
    queryFn: async () => ((await assetsApi.getTenantUsers()).data ?? []).map((u) => ({ value: String(u.id), label: u.display_name, description: u.email })),
    staleTime: 5 * 60 * 1000,
    retry: (n, err) => n < 2 && canRetry(err),
  });
  const library = useQuery({
    queryKey: ['evidence-for-exception-link'],
    queryFn: async () => ((await evidenceApi.getAll()).data as unknown as Array<{ id: number; name: string }>).map((ev) => ({ value: String(ev.id), label: ev.name })),
    retry: (n, err) => n < 2 && canRetry(err),
  });
  const save = useReportedMutation({
    mutationFn: (input: ControlInput) => (control ? policyExceptionApi.updateControl(exception.id, control.id, { ...input }) : policyExceptionApi.addControl(exception.id, { ...input })),
    success: control ? 'Control changed' : 'Control added',
    failure: control ? 'Control not changed' : 'Control not added',
    toast: 'success',                                                       // a refusal (a link that is not a web address, ...) is said in the dialog in the server's words
    invalidate: LIST_KEYS,
    onSuccess: onClose,
    onError: (error) => setProblem(errorMessage(error)),
  });
  const assetOptions = assets.map((a) => ({ value: String(a.asset_id), label: a.name, description: a.asset_type || undefined }));
  // every value already chosen has a name in its list (a person who left, an evidence item beyond the first page): a number is never drawn
  const riskOptions = withChosen(risks, f.riskIds, riskNames);
  const peopleOptions = withChosen(people.data ?? [], [f.ownerId], control?.owner ? { [String(control.owner.id)]: control.owner.name } : {});
  const libraryOptions = withChosen(library.data ?? [], f.evidence.map((ev) => (ev.kind === 'evidence' ? ev.evidenceId : null)),
    Object.fromEntries(f.evidence.filter((ev) => ev.kind === 'evidence' && ev.label).map((ev) => [(ev as { evidenceId: string }).evidenceId, ev.label])));
  const setEvidence = (i: number, patch: Partial<EvidenceDraft>) => set({ evidence: f.evidence.map((ev, j) => (j === i ? ({ ...ev, ...patch } as EvidenceDraft) : ev)) });

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title={control ? 'Edit control' : 'Add control'}
      subtitle={<span title={exception.title}>{truncate(exception.title, 120).text}</span>}
      dirty={controlFormTouched(f, initial)}
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => { setProblem(null); save.mutate(controlInput(f)); }}>{control ? 'Save' : 'Add control'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px] px-[20px] py-[16px]">
        {problem && <Notice tone="danger">{problem}</Notice>}
        <FormField label="Control" required>
          <TextInput maxLength={500} value={f.title} onChange={(ev) => set({ title: ev.target.value })} />
        </FormField>
        <FormField label="Description" optional>
          <Textarea rows={3} maxLength={4000} value={f.description} onChange={(ev) => set({ description: ev.target.value })} />
        </FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Covers risks" optional>
            <MultiSelect label="Covers risks" options={riskOptions} value={f.riskIds} onChange={(riskIds) => set({ riskIds })} placeholder={riskOptions.length ? 'Choose risks' : 'No risks recorded'} display="count" disabled={riskOptions.length === 0} />
          </FormField>
          <FormField label="Covers assets" optional>
            <MultiSelect label="Covers assets" options={assetOptions} value={f.assetIds} onChange={(assetIds) => set({ assetIds })} placeholder={assets.length ? 'Choose assets' : 'No assets'} display="count" disabled={assets.length === 0} />
          </FormField>
          <FormField label="Owner" optional>
            <Combobox label="Owner" options={peopleOptions} value={f.ownerId} onChange={(ownerId) => set({ ownerId })} placeholder={people.isLoading ? 'Loading people…' : 'Choose a person'} clearable />
          </FormField>
          <FormField label="Due date" optional>
            <TextInput type="date" value={f.due} onChange={(ev) => set({ due: ev.target.value })} />
          </FormField>
        </div>
        <div className="flex flex-col gap-[4px]">
          <span className="text-ds-label text-ds-fg">State</span>
          <SegmentedControl<'planned' | 'in_place'> label="State" name="control-state" value={f.status} onChange={(status) => set({ status })}
            options={[{ value: 'planned', label: 'Planned' }, { value: 'in_place', label: 'In place' }]} />
        </div>
        <div className="flex flex-col gap-[8px]">
          <span className="flex items-center gap-[4px] text-ds-label text-ds-fg">
            Evidence<span className="font-normal text-ds-fg-muted">(optional)</span>
            <InfoTip label="About evidence" text="A link to where the control is shown, or an item of the Evidence library." />
          </span>
          {f.evidence.length > 0 && (
            <ul className="flex flex-col gap-[8px]">
              {f.evidence.map((ev, i) => (
                <li key={i} className="flex flex-wrap items-start gap-[8px] rounded-ds-card border border-ds-border p-[8px]">
                  {ev.kind === 'link' ? (
                    <>
                      <TextInput aria-label="Link address" placeholder="https://" value={ev.url} onChange={(event) => setEvidence(i, { url: event.target.value })} className="min-w-0 flex-1 basis-[12rem]" />
                      <TextInput aria-label="Link label" placeholder="Label" value={ev.label} onChange={(event) => setEvidence(i, { label: event.target.value })} className="min-w-0 flex-1 basis-[8rem]" />
                    </>
                  ) : (
                    <Combobox label="Evidence item" options={libraryOptions} value={ev.evidenceId || null} onChange={(evidenceId) => setEvidence(i, { evidenceId: evidenceId ?? '' })}
                      placeholder={library.isLoading ? 'Loading evidence…' : 'Choose an item'} className="min-w-0 flex-1 basis-[12rem]" />
                  )}
                  <IconButton label="Remove evidence" onClick={() => set({ evidence: f.evidence.filter((_, j) => j !== i) })}><X aria-hidden /></IconButton>
                </li>
              ))}
            </ul>
          )}
          {library.isError && <span className="text-ds-label text-ds-danger">{`Couldn't load the Evidence library. ${errorMessage(library.error)}`}</span>}
          <div className="flex flex-wrap gap-[8px]">
            <Button size="sm" leftIcon={<Link2 aria-hidden />} onClick={() => set({ evidence: [...f.evidence, { kind: 'link', url: '', label: '' }] })}>Add link</Button>
            <Button size="sm" leftIcon={<FileText aria-hidden />} disabled={library.isError} onClick={() => set({ evidence: [...f.evidence, { kind: 'evidence', evidenceId: '', label: '' }] })}>Add from library</Button>
          </div>
        </div>
      </div>
    </AnimatedModal>
  );
}

export function ControlsPanel({ exception: e }: { exception: ExceptionItem }) {
  const headingId = useId();
  const { confirm, confirmDialog } = useConfirm();
  const answer = useQuery({
    queryKey: controlsKey(e.id),
    queryFn: async () => (await policyExceptionApi.getControls(e.id)).data as ControlsAnswer,
    retry: (n, err) => n < 2 && canRetry(err),
  });
  const riskAnswer = useQuery({                                              // the same request the Potential risks panel makes
    queryKey: risksKey(e.id),
    queryFn: async () => (await policyExceptionApi.getRisks(e.id)).data as RisksAnswer,
    retry: (n, err) => n < 2 && canRetry(err),
  });
  const impl = answer.data?.implementation ?? e.implementation;
  const canEdit = Boolean(impl?.my_turn);
  const risks = riskAnswer.data?.risks ?? [];
  const links = e.asset_links ?? [];
  const riskTitles = riskTitleMap(risks);
  const assetNames = assetNameMap(links);
  const coverable = coverableRisks(risks, currentRound(risks, e.approval?.round)).map((r) => ({ value: String(r.id), label: r.title as string }));
  const riskNames: Record<string, string> = Object.fromEntries(Object.entries(riskTitles));
  const [dialog, setDialog] = useState<{ control: CompensatingControl | null } | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const ai = useAiRun<AiControlsAnswer>(() => policyExceptionApi.aiControls(e.id));

  const remove = useReportedMutation({
    mutationFn: (c: CompensatingControl) => policyExceptionApi.deleteControl(e.id, c.id),
    success: 'Control removed',
    failure: 'Not removed',
    invalidate: LIST_KEYS,
  });
  const askRemove = async (c: CompensatingControl) => {
    if (await confirm({ title: 'Remove this control?', message: truncate(c.title, 120).text, confirmLabel: 'Remove control', tone: 'danger' })) remove.mutate(c);
  };
  const addSuggested = useReportedMutation({
    mutationFn: ({ suggestion }: { index: number; suggestion: AiControlsAnswer['controls'][number] }) =>
      policyExceptionApi.addControl(e.id, { title: suggestion.title, description: suggestion.description, risk_ids: suggestion.risk_ids, asset_ids: suggestion.asset_ids, source: 'ai' }),
    success: 'Control added',
    failure: 'Control not added',
    invalidate: LIST_KEYS,
    onSuccess: (_control, { index }) => setAdded((a) => [...a, index]),
  });

  const controls = answer.data?.controls ?? [];
  const uncovered = answer.data?.uncovered_risks ?? [];
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-ds-body font-[600] text-ds-fg">Compensating controls</h4>
        {canEdit && (
          <span className="flex flex-wrap items-center gap-[8px]">
            <span className="inline-flex items-center gap-1">
              <Button size="sm" leftIcon={<Sparkles aria-hidden />} loading={ai.run.status === 'loading'} onClick={() => { setAdded([]); void ai.ask(); }}>Suggest controls</Button>
              <InfoTip align="end" label="About suggesting controls" text="AI drafts controls for the potential risks and assets of this exception. Nothing is saved until you add one." />
            </span>
            <Button size="sm" variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setDialog({ control: null })}>Add control</Button>
          </span>
        )}
      </div>

      {uncovered.length > 0 && (
        <Notice tone={implementationOpen(impl) ? 'warning' : 'info'} title="Not covered yet">
          <ul aria-label="Potential risks without a control" className="list-disc pl-[16px]">{uncovered.map((r) => <li key={r.id} className="[overflow-wrap:anywhere]">{r.title ?? 'A potential risk'}</li>)}</ul>
        </Notice>
      )}

      {canEdit && (
        <AiBox run={ai.run} label="AI is drafting controls" onRetry={() => { void ai.ask(); }}>
          {(data) => (
            <div className="flex flex-col gap-[8px]">
              <ul aria-label="Suggested controls" className="flex flex-col gap-[8px]">
                {data.controls.map((s, i) => {
                  const covers = coverNames(s, riskTitles, assetNames);
                  const done = added.includes(i);
                  return (
                    <li key={i} className="flex flex-wrap items-start gap-x-[12px] gap-y-[8px] rounded-ds-card border border-ds-border p-[10px]">
                      <div className="flex min-w-0 flex-1 basis-[14rem] flex-col gap-[4px]">
                        <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.title}</span>
                        {s.description && <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{s.description}</p>}
                        {covers.risks.length > 0 && <Line label="Risks"><Chips names={covers.risks} label="Potential risks covered" /></Line>}
                        {covers.assets.length > 0 && <Line label="Assets"><Chips names={covers.assets} label="Assets covered" /></Line>}
                      </div>
                      <Button size="sm" leftIcon={done ? undefined : <Plus aria-hidden />} disabled={done} loading={addSuggested.isPending && addSuggested.variables?.index === i}
                        aria-label={`${done ? 'Added' : 'Add control'}: ${truncate(s.title, 50).text}`} onClick={() => addSuggested.mutate({ index: i, suggestion: s })}>{done ? 'Added' : 'Add'}</Button>
                    </li>
                  );
                })}
              </ul>
              <div><Button variant="link" size="sm" onClick={ai.clear}>Hide suggestions</Button></div>
            </div>
          )}
        </AiBox>
      )}

      {answer.isLoading ? <SkeletonLines lines={3} label="Loading the compensating controls" />
        : answer.isError && !answer.data ? <ErrorState compact title="Couldn't load the compensating controls" message={errorMessage(answer.error)} onRetry={canRetry(answer.error) ? () => { void answer.refetch(); } : undefined} />
        : controls.length === 0 ? <span className="text-ds-body text-ds-fg-muted">None recorded yet</span>
        : (
          <ul aria-labelledby={headingId} className="flex flex-col gap-[8px]">
            {controls.map((c) => (
              <ControlItem key={c.id} control={c} risks={riskTitles} assets={assetNames} onEdit={() => setDialog({ control: c })} onRemove={() => { void askRemove(c); }} />
            ))}
          </ul>
        )}

      {dialog && <ControlDialog key={dialog.control?.id ?? 'new'} exception={e} control={dialog.control} risks={coverable} riskNames={riskNames} assets={links} onClose={() => setDialog(null)} />}
      {confirmDialog}
    </div>
  );
}
