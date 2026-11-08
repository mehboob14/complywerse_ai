'use client';

/**
 * What a person can do to a file or to a set of them in the Library, and what each says when the server has answered: approve, send back for changes (with a note), submit for review,
 * renew a lapsed file, delete (asks first, and again when the server warns that the file is linked to controls), start the AI review again, and the same for the ticked files (bulk), plus
 * "Add to audit package". The rights are the ones the old workspace checked (approve and send back: `evidence_library:create`; delete: `delete`; submit: everyone; renew: `edit`, as on
 * the record page); none is added. Every action is a useReportedMutation: the confirmation comes after the server answers, a failure stays with its words and a Retry where repeating is safe.
 * The one thing it draws is its two sheets and its confirm dialog (`ui`).
 */
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Combobox, ErrorState, FormField, Sheet, Skeleton, Textarea, useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, truncate } from '@/lib/format';
import { deleteEvidence, reviewEvidence, runAssessment, submitForReview } from '../_workspace/api';
import { bulkDetails, bulkPlan, type BulkKind, type LibraryRow } from './libraryModel';
import { LIBRARY_REFRESH, addToPackage, renewEvidence, useDraftPackages } from './libraryData';

export interface LibraryRights { canReview: boolean; canEdit: boolean; canDelete: boolean }

interface BulkResult { done: number; failed: number; skipped: number; why: string; note?: string }
const short = (name: string) => truncate(name, 60).text;
const MUTED = 'text-ds-fg-muted';

export function useLibraryActions(rows: readonly LibraryRow[], rights: LibraryRights, onGone: (id: number) => void) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [sendBack, setSendBack] = useState<{ id: number; note: string } | null>(null);
  const [packaging, setPackaging] = useState<number[] | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const named = (id: number) => short(rows.find((r) => r.id === id)?.name ?? 'this evidence');

  const approve = useReportedMutation<unknown, number>({
    mutationFn: async (id) => (await reviewEvidence(id, 'approve')).data,
    success: (_, id) => `Approved “${named(id)}”`, failure: "Couldn't approve the evidence", invalidate: LIBRARY_REFRESH,
  });
  const submit = useReportedMutation<unknown, number>({
    mutationFn: async (id) => (await submitForReview(id)).data,
    success: (_, id) => `Submitted “${named(id)}” for review`, failure: "Couldn't submit the evidence for review", invalidate: LIBRARY_REFRESH,
  });
  const sendBackMutation = useReportedMutation<unknown, { id: number; note: string }>({
    mutationFn: async ({ id, note }) => (await reviewEvidence(id, 'reject', note.trim() || undefined)).data,
    success: (_, v) => ({ title: `Sent “${named(v.id)}” back`, message: 'It is a draft again, with your note, until its owner submits it.' }),
    failure: "Couldn't send the evidence back", invalidate: LIBRARY_REFRESH,
    onSuccess: () => setSendBack(null),
  });
  const reassess = useReportedMutation<unknown, number>({
    mutationFn: async (id) => (await runAssessment(id)).data,
    success: 'The AI review has started. The rating appears here in a few seconds.', failure: "Couldn't start the AI review", invalidate: [...LIBRARY_REFRESH, ['evidence-review']],
  });
  const renewMutation = useReportedMutation<unknown, number>({
    mutationFn: async (id) => (await renewEvidence(id)).data,
    success: (_, id) => ({ title: `Renewed “${named(id)}”`, message: 'It is a draft again and needs a new review before it counts.' }),
    failure: "Couldn't renew the evidence", invalidate: [...LIBRARY_REFRESH, ['evidence-detail']],
  });
  const remove = useReportedMutation<{ warning?: boolean; message?: string } | undefined, { id: number; force: boolean }>({
    mutationFn: async ({ id, force }) => (await deleteEvidence(id, force)).data as { warning?: boolean; message?: string } | undefined,
    success: 'Evidence deleted', failure: "Couldn't delete the evidence", toast: 'errors',
    onSuccess: (data, v) => {
      if (data?.warning) { void askForce(v.id, data.message); return; }
      notify.success(`Deleted “${named(v.id)}”`);
      onGone(v.id);
      LIBRARY_REFRESH.forEach((key) => { void qc.invalidateQueries({ queryKey: key }); });
    },
  });
  const askForce = async (id: number, message: string | undefined) => {
    const yes = await confirm({ title: 'Delete it anyway?', message: message || 'This evidence is linked to controls.', confirmLabel: 'Delete anyway', tone: 'danger' });
    if (yes) remove.mutate({ id, force: true });
  };
  const askDelete = async (id: number) => {
    const yes = await confirm({ title: 'Delete this evidence?', message: `“${named(id)}” will be deleted. This can't be undone.`, confirmLabel: 'Delete evidence', tone: 'danger' });
    if (yes) remove.mutate({ id, force: false });
  };
  const askRenew = async (id: number) => {
    const days = rows.find((r) => r.id === id)?.validity_period_days || 365;
    const yes = await confirm({
      title: 'Renew this evidence?',
      message: `Its collection date becomes today and it is valid for ${formatCount(days)} ${days === 1 ? 'day' : 'days'} from now. It goes back to Draft and needs a new review before it counts again.`,
      confirmLabel: 'Renew evidence',
    });
    if (yes) renewMutation.mutate(id);
  };

  // ── the ticked files ──
  const bulk = useReportedMutation<BulkResult, { kind: BulkKind; ids: number[]; skipped: number; why: string; packageId?: number }>({
    mutationFn: async ({ kind, ids, skipped, why, packageId: target }) => {
      if (kind === 'package') {
        await addToPackage(target as number, ids);
        return { done: ids.length, failed: 0, skipped, why };
      }
      let done = 0;
      let linked = 0;
      let failed = 0;
      let lastError: unknown = null;
      for (const id of ids) {                                                              // one after the other: the server's pool is small
        try {
          if (kind === 'submit') await submitForReview(id);
          else if (kind === 'approve') await reviewEvidence(id, 'approve');
          else {
            const r = (await deleteEvidence(id, false)).data as { warning?: boolean } | undefined;
            if (r?.warning) linked += 1; else done += 1;
            continue;
          }
          done += 1;
        } catch (e) { failed += 1; lastError = e; }
      }
      if (done === 0 && linked === 0 && failed > 0) throw lastError instanceof Error ? lastError : new Error('None of the files could be changed.');
      return { done, failed, skipped, why, note: linked ? `${formatCount(linked)} ${linked === 1 ? 'is' : 'are'} linked to controls and left in place. Open one to delete it.` : undefined };
    },
    success: (result, v) => {
      const verb = { submit: 'Submitted', approve: 'Approved', delete: 'Deleted', package: 'Added' }[v.kind];
      const title = v.kind === 'package' ? 'Added to the audit package' : `${verb} ${formatCount(result.done)} ${result.done === 1 ? 'file' : 'files'}`;
      return { title, message: [bulkDetails(result), result.note].filter(Boolean).join(' ') || undefined };
    },
    failure: "Couldn't change the files",
    invalidate: LIBRARY_REFRESH,
  });

  const runBulk = async (kind: BulkKind, ticked: readonly LibraryRow[]) => {
    const plan = bulkPlan(kind, ticked, { canReview: rights.canReview, canDelete: rights.canDelete });
    if (plan.ids.length === 0) { notify.warning(`None of the ${formatCount(ticked.length)} selected files can be changed this way (${plan.why}).`, { title: 'Nothing to do' }); return; }
    if (kind === 'package') { setPackageId(null); setPackaging(plan.ids); return; }
    if (kind === 'delete') {
      const yes = await confirm({ title: `Delete ${formatCount(plan.ids.length)} ${plan.ids.length === 1 ? 'file' : 'files'}?`, message: 'They will be deleted. A file linked to controls is left in place. This can\'t be undone.', confirmLabel: 'Delete files', tone: 'danger' });
      if (!yes) return;
    }
    bulk.mutate({ kind, ids: plan.ids, skipped: plan.skipped, why: plan.why });
  };

  const drafts = useDraftPackages(packaging !== null);
  const closePackaging = () => { setPackaging(null); setPackageId(null); };
  const pickerError = drafts.isError && !drafts.data;

  const ui: ReactNode = (
    <>
      <Sheet
        open={sendBack !== null}
        onClose={() => setSendBack(null)}
        dirty={!!sendBack?.note.trim()}
        title="Send back for changes"
        subtitle={sendBack ? short(rows.find((r) => r.id === sendBack.id)?.name ?? '') : undefined}
        width="sm"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-[8px]">
            <Button onClick={() => setSendBack(null)}>Cancel</Button>
            <Button variant="primary" loading={sendBackMutation.isPending} onClick={() => { if (sendBack) sendBackMutation.mutate(sendBack); }}>Send back</Button>
          </div>
        )}
      >
        <FormField label="What should change?" optional hint="The file becomes a draft again and its owner sees this note.">
          <Textarea rows={4} maxLength={1000} value={sendBack?.note ?? ''} onChange={(e) => setSendBack((s) => (s ? { ...s, note: e.target.value } : s))} placeholder="For example: the signed page is missing" />
        </FormField>
      </Sheet>

      <Sheet
        open={packaging !== null}
        onClose={closePackaging}
        title="Add to audit package"
        subtitle={packaging ? `${formatCount(packaging.length)} approved ${packaging.length === 1 ? 'file' : 'files'}` : undefined}
        width="sm"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-[8px]">
            <Button onClick={closePackaging}>Cancel</Button>
            <Button
              variant="primary" loading={bulk.isPending} disabled={packageId === null}
              onClick={() => { if (packaging && packageId) { bulk.mutate({ kind: 'package', ids: packaging, skipped: 0, why: '', packageId: Number(packageId) }, { onSuccess: closePackaging }); } }}
            >
              Add to package
            </Button>
          </div>
        )}
      >
        {drafts.isLoading ? <Skeleton className="h-[32px] w-full" /> : pickerError ? (
          <ErrorState compact title="Couldn't load the audit packages" message={errorMessage(drafts.error)} onRetry={canRetry(drafts.error) ? () => { void drafts.refetch(); } : undefined} />
        ) : (drafts.data ?? []).length === 0 ? (
          <p className={`text-ds-body ${MUTED}`}>There is no draft audit package yet. Create one under Audit packages, then add files to it.</p>
        ) : (
          <FormField label="Audit package" hint="Only a draft package takes more evidence.">
            <Combobox
              label="Audit package" placeholder="Choose a package" searchPlaceholder="Search packages" value={packageId} onChange={setPackageId}
              options={(drafts.data ?? []).map((p) => ({ value: String(p.id), label: p.name, description: `${p.framework_name ?? 'No framework'} · ${formatCount(p.evidence_count)} ${p.evidence_count === 1 ? 'file' : 'files'}` }))}
            />
          </FormField>
        )}
      </Sheet>
      {confirmDialog}
    </>
  );

  const pending = {
    approve: approve.isPending ? approve.variables ?? null : null,
    submit: submit.isPending ? submit.variables ?? null : null,
    reassess: reassess.isPending ? reassess.variables ?? null : null,
    renew: renewMutation.isPending ? renewMutation.variables ?? null : null,
    remove: remove.isPending ? remove.variables?.id ?? null : null,
    bulk: bulk.isPending,
  };

  return {
    ui,
    pending,
    approve: (id: number) => approve.mutate(id),
    submit: (id: number) => submit.mutate(id),
    sendBack: (id: number) => { sendBackMutation.reset(); setSendBack({ id, note: '' }); },
    reassess: (id: number) => reassess.mutate(id),
    renew: (id: number) => { void askRenew(id); },
    remove: (id: number) => { void askDelete(id); },
    bulk: runBulk,
    addToPackage: (ids: number[]) => { setPackageId(null); setPackaging(ids); },
  };
}
