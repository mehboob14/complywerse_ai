'use client';

// One default of a unit, as a card: who is asked (reviewers, approvers, the stages of a custom route, or the implementer of an exception), where it comes from (set here, "Inherited from
// Operations", the organisation's), whether it is locked, and what the person may do about it: Set, Edit, Override (an inherited one: it opens on what is inherited, change it, then
// save), Revert to inherited (the unit's own is removed; documents already in review keep their people). A person who may not change it reads it. A lock above stands over this
// unit: the card says who locked it and offers nothing to change (the server refuses a write below a lock with 409, and its sentence is shown if it is ever asked). The rules of what
// the card offers are approvalsModel.cardView (tested), the forms' rules lib/approvalDefaults.ts, the requests lib/approvalDefaultsApi.ts.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Undo2 } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Checkbox, ErrorState, FormError, MultiSelect, Notice, SectionCard, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { revertDefault, saveDefault, type UnitRef } from '@/lib/approvalDefaultsApi';
import {
  KIND_LABEL, SUBJECT_TITLE, bodyOf, draftOf, draftProblem, peopleLine, pickOptions, sameDraft, sourceName, stageHow,
  type DefaultPerson, type DefaultRow, type Draft, type RouteRowStage, type Subject, type SubjectState, type Targets,
} from '@/lib/approvalDefaults';
import { cardView, organisationLine, rowWords } from './approvalsModel';
import { RouteEditor } from './RouteEditor';
import { useRefreshDefaults } from './defaultsData';

const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label font-normal text-ds-fg-body [overflow-wrap:anywhere]';
const LOCK_NOTE = "A locked default applies to every unit below it, which cannot change or replace it. Its people must stay among the participants of every document: sending one without them is refused.";
const ACTIVE_NOTE = 'Switch it off to keep it saved without applying it.';
const EMPTY: Record<Subject, string> = {
  doc_review: 'No default reviewers. The author of a document names them.',
  doc_approval: 'No default approvers. The author of a document names them.',
  doc_route: 'No custom route. Documents use the reviewers and approvers.',
  exc_implementer: 'No default implementer. The author of an exception chooses.',
};
const WHO: Record<Subject, string> = { doc_review: 'reviewers', doc_approval: 'approvers', doc_route: 'route', exc_implementer: 'implementer' };

/** What a picker reads from a query. */
export interface TargetsSource { data?: Targets; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }

interface Props {
  subject: Subject;
  unit: UnitRef;
  /** the unit's name, or "the organisation" */
  unitName: string;
  state: SubjectState;
  /** the organisation's own answer, when it can be read: a line under a card the unit overrides */
  org: SubjectState | null;
  /** the server's `can_edit` */
  canEdit: boolean;
  targets: TargetsSource;
  /** the (i) of the title */
  info: string;
  /** how the editor says typed input is held (the popup then asks before it is closed) */
  onDirty: (key: string, dirty: boolean) => void;
  /** open another unit's popup (the one that locked this default) */
  openUnit?: (id: number) => void;
}

function Chips({ people }: { people: readonly Pick<DefaultPerson, 'type' | 'label' | 'holder'>[] }) {
  return <>{people.map((p, i) => <span key={i} className={CHIP}>{peopleLine([p])}</span>)}</>;
}

function RouteList({ route }: { route: readonly RouteRowStage[] }) {
  return (
    <ol aria-label="Stages of the route" className="m-0 flex list-none flex-col gap-[8px] p-0">
      {route.map((s, i) => {
        const how = stageHow(s);
        return (
          <li key={s.position} className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
            <div className="flex flex-wrap items-baseline gap-x-[8px] gap-y-[2px]">
              <span aria-hidden className="text-ds-label font-[600] text-ds-fg-muted">{i + 1}.</span>
              <span className="text-ds-body font-[600] text-ds-fg">{s.name}</span>
              <span className="text-ds-label font-normal text-ds-fg-muted">{[s.name === KIND_LABEL[s.kind] ? '' : KIND_LABEL[s.kind], how].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="mt-[6px] flex flex-wrap gap-[6px]">
              {s.people.map((p, k) => <span key={k} className={CHIP}>{peopleLine([{ type: p.target_type, label: p.label, holder: p.holder }])}</span>)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Body({ subject, row }: { subject: Subject; row: DefaultRow | null }) {
  if (!row || (row.route === null && row.people.length === 0)) return <p className="text-ds-body text-ds-fg-muted">{EMPTY[subject]}</p>;
  if (subject === 'doc_route' && row.route) return <RouteList route={row.route} />;
  return <div className="flex flex-wrap gap-[6px]"><Chips people={row.people} /></div>;
}

const keepOf = (row: DefaultRow | null) => [
  ...(row?.people ?? []),
  ...(row?.route ?? []).flatMap((s) => s.people.map((p) => ({ type: p.target_type, id: p.target_id, label: p.label, holder: p.holder }))),
];

export function DefaultCard({ subject, unit, unitName, state, org, canEdit, targets, info, onDirty, openUnit }: Props) {
  const isOrg = unit === 'org';
  const title = SUBJECT_TITLE[subject];
  const view = cardView(state, { canEdit, org: isOrg });
  const refresh = useRefreshDefaults();
  const { confirm, confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);                   // null: reading
  const [initial, setInitial] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [tried, setTried] = useState(false);
  const editing = draft !== null && initial !== null;
  const changed = editing && !sameDraft(subject, draft, initial);
  const report = useRef(onDirty);
  report.current = onDirty;
  useEffect(() => { report.current(subject, changed); }, [subject, changed]);
  useEffect(() => () => report.current(subject, false), [subject]);

  const open = (row: DefaultRow | null) => { const d = draftOf(row); setInitial(d); setDraft(d); setProblem(null); setTried(false); };
  const close = () => { setDraft(null); setInitial(null); setProblem(null); setTried(false); };

  const save = useReportedMutation({
    mutationFn: () => saveDefault(unit, subject, bodyOf(subject, draft as Draft)),
    success: `${title} saved`,
    failure: 'Not saved',
    toast: 'success',                                                      // a refusal is said above the fields, in the server's words
    retryable: false,
    onSuccess: () => { close(); refresh(); },
    onError: (e) => setProblem(e),
  });
  const revert = useReportedMutation({
    mutationFn: () => revertDefault(unit, subject),
    success: isOrg ? `${title} removed` : `${title}: back to inherited`,
    failure: 'Not changed',
    onSuccess: () => { close(); refresh(); },
  });
  const askRevert = async () => {
    const ok = await confirm({
      title: isOrg ? `Remove the ${WHO[subject]}?` : `Revert the ${WHO[subject]} to inherited?`,
      message: isOrg
        ? `The organisation no longer sets them. Documents already in review keep the people they have.`
        : `${unitName} goes back to what it inherits, or to nothing. Documents already in review keep the people they have.`,
      confirmLabel: isOrg ? 'Remove' : 'Revert',
      tone: 'danger',
    });
    if (ok) revert.mutate();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!draft || draftProblem(subject, draft)) return;
    setProblem(null);
    save.mutate();
  };

  const options = pickOptions(targets.data, { teams: subject !== 'exc_implementer', keep: keepOf(view.row) });
  const local = tried && draft ? draftProblem(subject, draft) : '';
  const orgLine = isOrg ? null : organisationLine(org, state);
  const busy = save.isPending || revert.isPending;

  const actions = editing ? undefined : (
    <>
      {view.can.set && <Button leftIcon={<Plus aria-hidden />} onClick={() => open(null)}>Set<span className="sr-only"> ({WHO[subject]})</span></Button>}
      {view.can.override && <Button leftIcon={<Pencil aria-hidden />} onClick={() => open(view.row)}>Override<span className="sr-only"> ({WHO[subject]})</span></Button>}
      {view.can.edit && <Button leftIcon={<Pencil aria-hidden />} onClick={() => open(state.own)}>Edit<span className="sr-only"> ({WHO[subject]})</span></Button>}
      {view.can.revert && <Button leftIcon={<Undo2 aria-hidden />} loading={revert.isPending} disabled={busy} onClick={() => { void askRevert(); }}>{isOrg ? 'Remove' : 'Revert to inherited'}<span className="sr-only"> ({WHO[subject]})</span></Button>}
    </>
  );

  return (
    <SectionCard
      id={`defaults-${subject}`}
      title={title}
      info={info}
      meta={<span className="inline-flex flex-wrap items-center gap-[6px] align-middle">{view.pills.map((p) => <StatusPill key={p.label} size="sm" tone={p.tone} label={p.label} />)}</span>}
      actions={actions}
    >
      <div className="flex flex-col gap-[12px]">
        {view.lockedBy && (
          <Notice
            title={`Locked by ${sourceName(view.lockedBy)}`}
            action={view.lockedBy.department_id !== null && openUnit ? <Button size="sm" onClick={() => openUnit(view.lockedBy?.department_id as number)}>Open {view.lockedBy.name}</Button> : undefined}
          >
            It applies here and below. It cannot be changed or replaced here.
          </Notice>
        )}

        {!editing && (
          <>
            <Body subject={subject} row={view.row} />
            {view.idle && view.instead && (
              <p className="text-ds-body text-ds-fg-muted">In force instead, from {sourceName(view.instead.source)}: {rowWords(view.instead.row)}</p>
            )}
            {view.idle && !view.instead && state.own && !state.own.is_active && <p className="text-ds-body text-ds-fg-muted">Switched off: documents do not use it.</p>}
            {orgLine && <p className="text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]">{orgLine}</p>}
          </>
        )}

        {editing && draft && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-[12px]">
            <FormError title={`Couldn't save the ${WHO[subject]}`} error={problem} />
            {subject === 'doc_route' ? (
              <RouteEditor stages={draft.stages} onChange={(stages) => setDraft({ ...draft, stages })} options={options} disabled={save.isPending} />
            ) : targets.isError && !targets.data ? (
              <ErrorState compact title="Couldn't load the people" message={errorMessage(targets.error)} onRetry={canRetry(targets.error) ? () => { void targets.refetch(); } : undefined} />
            ) : (
              <MultiSelect
                label={title}
                options={options}
                value={draft.people}
                onChange={(people) => setDraft({ ...draft, people })}
                display="chips"
                placeholder={targets.isLoading ? 'Loading people' : subject === 'exc_implementer' ? 'People, roles or owners' : 'People, roles, departments or owners'}
                searchPlaceholder="Search"
                disabled={save.isPending}
              />
            )}
            {local && <p role="alert" className="text-ds-body text-ds-danger [overflow-wrap:anywhere]">{local}</p>}
            <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[4px]">
              <span className="inline-flex items-center gap-[4px]">
                <Checkbox label="Locked" checked={draft.locked} disabled={save.isPending} onChange={(e) => setDraft({ ...draft, locked: e.target.checked })} />
                <InfoTip text={LOCK_NOTE} label="About locking a default" />
              </span>
              {state.own && (
                <span className="inline-flex items-center gap-[4px]">
                  <Checkbox label="In force" checked={draft.active} disabled={save.isPending} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                  <InfoTip text={ACTIVE_NOTE} label="About switching a default off" />
                </span>
              )}
              <span className="ml-auto flex items-center gap-[8px]">
                <Button disabled={save.isPending} onClick={close}>Cancel</Button>
                <Button type="submit" variant="primary" loading={save.isPending} disabled={!!state.own && !changed}>Save</Button>
              </span>
            </div>
          </form>
        )}
      </div>
      {confirmDialog}
    </SectionCard>
  );
}
