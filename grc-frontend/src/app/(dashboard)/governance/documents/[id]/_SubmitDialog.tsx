'use client';

// "Submit for review": the document's approval route, then send it, in one step. It opens with today's two stages (the
// reviewers, then the approvers); stages can be added, named, ordered, and each asks its people all at once or one after another,
// with everyone, any one or at least N signing, in the days given. Kept as reviewers and approvers while it has that shape
// (…/signoff/participants), else as a route of its own (…/signoff/route); then …/signoff/send-for-review.
// Backend: routers/document_signoff.py, modules/governance/routes.py.
// The fields and buttons are the kit's. Sending is two requests in one (the route, then the send) and the words of its outcome depend on what the
// server said (who could not be asked), so it reports through useNotify/useToast itself rather than useReportedMutation. Escape and the X ask
// "Discard changes?" once the route was changed.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Send, X } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { Button, FormField, IconButton, Select, TextInput, useNotify } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { sentToast } from '@/lib/signoffTargets';
import {
  KIND_OPTIONS, blankStage, isDefaultShape, moved, picked, routeProblem, routeSummary, stagesOf, toApi, used,
  type DraftStage, type StageKind, type Target,
} from '@/lib/approvalRoutes';
import { keepLocked, requiredIn } from '@/lib/approvalDefaults';
import { AssigneeMultiSelect, useAssigneeOptions, useSignoff, type Participant } from '../_SignoffControl';
import { DefaultsNotice, requiredLine, useDocumentDefaults } from './_DefaultsNotice';

const ids = (list: Participant[]) => list.map(({ target_type, target_id }) => ({ target_type, target_id }));
const keyOf = (p: Target) => `${p.target_type}:${p.target_id}`;
const KIND_NAME = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label])) as Record<StageKind, string>;

export default function SubmitDialog({ documentId, doc, open, onClose }: { documentId: number; doc: any; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const notify = useNotify();
  const qc = useQueryClient();
  const options = useAssigneeOptions(doc?.tenant_id);
  const { data } = useSignoff(documentId);
  const defaults = useDocumentDefaults(doc, data, open);              // the unit's approval defaults: what Send would copy in, and who a lock keeps in
  const [stages, setStages] = useState<DraftStage[]>([]);
  const [filled, setFilled] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);       // the route as it was when the popup opened: what "changed" is measured against

  // fill from the saved route once per opening, so a background refetch never wipes a choice being made
  useEffect(() => {
    if (!open) { setFilled(false); setSnapshot(null); return; }
    if (!filled && data) {
      const first = stagesOf(data.route, data.participants?.reviewer || [], data.participants?.approver || []);
      setStages(first);
      setSnapshot(JSON.stringify(first));
      setFilled(true);
    }
  }, [open, data, filled]);
  const dirty = filled && snapshot !== null && JSON.stringify(stages) !== snapshot;
  // nobody named: the defaults of the unit are copied in when it is sent; the author may name people instead. Named: a locked default's people stay in (they are put back, never removed).
  const named = used(stages).length > 0;
  const fromDefaults = !!defaults.available && !named;
  useEffect(() => {
    if (!filled || !named) return;
    const kept = keepLocked(stages, defaults.needs);
    if (kept !== stages) setStages(kept);
  }, [stages, filled, named, defaults.needs]);

  const names = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  const nameOf = (t: Target) => t.display || names.get(keyOf(t)) || `${t.target_type} ${t.target_id}`;
  const update = (i: number, patch: Partial<DraftStage>) => setStages((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStage = () => setStages((all) => {
    const at = all.length && all[all.length - 1].kind === 'approval' ? all.length - 1 : all.length;     // before the approval, usually last
    return [...all.slice(0, at), blankStage('review'), ...all.slice(at)];
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['doc-signoff', documentId] });
    qc.invalidateQueries({ queryKey: ['governance-document', documentId] });
    qc.invalidateQueries({ queryKey: ['document-lifecycle'] });
    qc.invalidateQueries({ queryKey: ['document-access', documentId] });
  };

  const send = useMutation({
    mutationFn: async () => {
      if (fromDefaults) {                      // nobody named: the server copies the unit's defaults in when it sends
        if (data?.route?.custom) await governanceApi.setSignoffRoute(documentId, { stages: [] });
      } else if (isDefaultShape(stages)) {        // today's flow: kept as reviewers and approvers
        const review = used(stages).find((s) => s.kind === 'review');
        const approval = used(stages).find((s) => s.kind === 'approval');
        if (data?.route?.custom) await governanceApi.setSignoffRoute(documentId, { stages: [] });
        await governanceApi.setSignoffParticipants(documentId, {
          prepared_by: ids(data?.participants?.prepared_by || []), reviewers: ids(review?.people || []), approvers: ids(approval?.people || []),
        });
      } else {
        await governanceApi.setSignoffRoute(documentId, { stages: toApi(stages) });
      }
      try {
        return (await governanceApi.sendDocumentForReview(documentId)).data;
      } catch (e: any) {
        throw Object.assign(e ?? {}, { participantsSaved: true });
      }
    },
    onSuccess: (sent: any) => {
      // the server names reviewers or approvers nobody can sign for (a role or department without users of this platform)
      const first = used(stages)[0];
      const said = sentToast(sent, fromDefaults ? 'The defaults of its unit were applied and their people asked.'
        : isDefaultShape(stages) ? (first?.kind === 'review' ? 'Reviewers were asked' : 'Approvers were asked')
          : `Its first stage (${first?.name ?? 'Review'}) was asked.`);
      toast(said);                                       // titled by where it went: for review, or straight for approval
      refresh();
      if (said.title !== 'Not sent') onClose();          // still a draft: it stays open to choose others
    },
    onError: (e: any) => {
      if (e?.participantsSaved) refresh();
      // the server's words, cleaned; no Retry: a second try could ask the people twice
      notify.error(
        e?.participantsSaved ? `The route was saved, but sending failed: ${errorMessage(e, 'please try again.')}` : errorMessage(e, 'Could not save who reviews and approves it.'),
        { title: 'Not sent' },
      );
    },
  });

  const problem = fromDefaults ? '' : routeProblem(stages);
  const summary = fromDefaults ? defaults.line : routeSummary(stages, nameOf);
  const version = doc?.version ?? data?.version;

  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      size="xl"
      title="Submit for review"
      subtitle={[doc?.title, version ? `v${version}` : ''].filter(Boolean).join(' · ')}
      dirty={dirty}
      headerAccessory={(
        <InfoTip align="end" label="About submitting for review"
          text="Each stage is asked in order; the next one starts when it is signed. Anyone whose turn it is can ask for changes, which waits for you to make them and resubmit. A role or a department is signed by its first member." />
      )}
      className="max-sm:max-h-[100dvh] max-sm:h-[100dvh] max-sm:rounded-none"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className={`mr-auto min-w-0 flex-1 text-xs ${problem ? 'text-[#9b1c1c]' : 'text-[#26323d]'}`} role={problem ? 'alert' : undefined}>
            {problem || summary}
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={<Send aria-hidden />} loading={send.isPending} disabled={!!problem || !data} title={problem || undefined} onClick={() => send.mutate()}>
            Submit
          </Button>
        </div>
      }
    >
      <div className="max-h-[65vh] space-y-3 overflow-y-auto px-5 py-4 max-sm:max-h-none">
        <DefaultsNotice defaults={defaults} named={named} />
        <ol className="space-y-3">
          {stages.map((s, i) => (
            <li key={s.key} className="rounded-xl border border-[#d5dbe1] bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e6f4f1] text-xs font-semibold text-[#0b4f46]">{i + 1}</span>
                <Select aria-label={`Stage ${i + 1}: what it is`} value={s.kind} className="w-[11rem]"
                  onChange={(e) => {
                    const kind = e.target.value as StageKind;
                    update(i, { kind, name: s.name.trim() === KIND_NAME[s.kind] || !s.name.trim() ? KIND_NAME[kind] : s.name });
                  }}>
                  {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </Select>
                <TextInput aria-label={`Stage ${i + 1}: name`} value={s.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={120}
                  placeholder={KIND_NAME[s.kind]} className="min-w-[10rem] flex-1" />
                <span className="ml-auto flex items-center">
                  <IconButton label={`Move stage ${i + 1} up`} disabled={i === 0} onClick={() => setStages((all) => moved(all, i, -1))}><ArrowUp aria-hidden /></IconButton>
                  <IconButton label={`Move stage ${i + 1} down`} disabled={i === stages.length - 1} onClick={() => setStages((all) => moved(all, i, 1))}><ArrowDown aria-hidden /></IconButton>
                  <IconButton label={`Remove stage ${i + 1}`} disabled={stages.length === 1} onClick={() => setStages((all) => all.filter((_, j) => j !== i))}><X aria-hidden /></IconButton>
                </span>
              </div>
              <div className="mt-2">
                <AssigneeMultiSelect label={s.kind === 'information' ? 'Who is told' : 'Who is asked'} value={s.people} options={options}
                  onChange={(next) => update(i, { people: picked(next.map(keyOf), s.people) })} />
                {requiredIn(s, defaults.needs).length > 0 && <p className="mt-1 text-ds-label text-ds-fg-muted">{requiredLine(requiredIn(s, defaults.needs))}</p>}
              </div>
              {s.order === 'in_turn' && s.people.length > 1 && (
                <ol className="mt-2 space-y-1" aria-label={`Stage ${i + 1}: the order they are asked in`}>
                  {s.people.map((p, k) => (
                    <li key={keyOf(p)} className="flex items-center gap-2 rounded-lg bg-[#f4f6f8] px-2 py-1 text-xs text-[#26323d]">
                      <span className="w-4 text-right font-semibold text-[#586472]">{k + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{nameOf(p)}</span>
                      <IconButton label={`Ask ${nameOf(p)} earlier`} disabled={k === 0} onClick={() => update(i, { people: moved(s.people, k, -1) })}><ArrowUp aria-hidden /></IconButton>
                      <IconButton label={`Ask ${nameOf(p)} later`} disabled={k === s.people.length - 1} onClick={() => update(i, { people: moved(s.people, k, 1) })}><ArrowDown aria-hidden /></IconButton>
                    </li>
                  ))}
                </ol>
              )}
              {s.kind !== 'information' && (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {s.people.length > 1 && (
                    <FormField label="Asked" className="w-[11rem]">
                      <Select value={s.order} onChange={(e) => update(i, { order: e.target.value as DraftStage['order'] })}>
                        <option value="together">All at once</option>
                        <option value="in_turn">One after another</option>
                      </Select>
                    </FormField>
                  )}
                  {s.people.length > 1 && s.order === 'together' && (
                    <div className="flex items-end gap-1.5">
                      <FormField label="Who signs" className="w-[10rem]">
                        <Select value={s.rule} onChange={(e) => update(i, { rule: e.target.value as DraftStage['rule'] })}>
                          <option value="all">Everyone</option>
                          <option value="any">Any one</option>
                          <option value="at_least">At least…</option>
                        </Select>
                      </FormField>
                      {s.rule === 'at_least' && (
                        <TextInput type="number" min={1} max={s.people.length} aria-label={`Stage ${i + 1}: at least how many`} value={s.min_count}
                          onChange={(e) => update(i, { min_count: Number(e.target.value) })} className="w-[5rem]" />
                      )}
                    </div>
                  )}
                  <FormField label="Days to act" className="w-[9rem]">
                    <TextInput type="number" min={1} max={365} value={s.due_days ?? ''} placeholder="As in Settings"
                      onChange={(e) => update(i, { due_days: e.target.value === '' ? null : Number(e.target.value) })} />
                  </FormField>
                </div>
              )}
              {!s.people.length && <p className="mt-1.5 text-xs text-[#586472]">Nobody chosen: this stage is skipped.</p>}
            </li>
          ))}
        </ol>
        <Button leftIcon={<Plus aria-hidden />} onClick={addStage}>Add stage</Button>
      </div>
    </AnimatedModal>
  );
}
