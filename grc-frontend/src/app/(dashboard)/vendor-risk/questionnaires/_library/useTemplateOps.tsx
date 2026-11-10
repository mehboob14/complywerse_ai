'use client';

// What a person does to a questionnaire of the Library, in one place for the card, the list row and the menu: archive or restore, duplicate (and open the copy), delete (only one that was never sent, after
// asking). Each reports: a confirmation that names the questionnaire, a failure that stays on screen with Retry where asking again can help. The rights are the server's (hubModel.templateActions).
import { useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm, useReportedMutation } from '@/components/ui/ds';
import { builderHref, questionnairesApi, templatesKey } from '../../_lib/questionnairesApi';
import type { Template } from '../../_lib/questionnaires/types';

export interface TemplateOps {
  archive: (t: Template) => void;
  duplicate: (t: Template) => void;
  /** asks first: "Delete this questionnaire?" */
  remove: (t: Template) => Promise<void>;
  busy: boolean;
  confirmDialog: ReactNode;
}

export function useTemplateOps(): TemplateOps {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const invalidate = [[...templatesKey], ['tprm-questionnaire-template']];      // the list, and the one open in the builder

  const archive = useReportedMutation({
    mutationFn: async (t: Template) => (await (t.archived_at ? questionnairesApi.restore(t.id) : questionnairesApi.archive(t.id))).data,
    success: (next) => (next.archived_at ? `Archived: ${next.name}` : `Restored: ${next.name}`),
    failure: "Couldn't change the questionnaire",
    invalidate,
  });
  const duplicate = useReportedMutation({
    mutationFn: async (t: Template) => (await questionnairesApi.duplicate(t.id)).data,
    success: (copy) => `Copied as ${copy.name}`,
    failure: "Couldn't copy the questionnaire",
    retryable: false,                                              // a copy is not safe to repeat
    invalidate,
    onSuccess: (copy) => router.push(builderHref(copy.id)),
  });
  const del = useReportedMutation({
    mutationFn: async (t: Template) => { await questionnairesApi.remove(t.id); },
    success: (_d, t) => `Deleted: ${t.name}`,
    failure: "Couldn't delete the questionnaire",
    invalidate,
  });
  const remove = useCallback(async (t: Template) => {
    const yes = await confirm({
      title: 'Delete this questionnaire?',
      message: `${t.name} has never been sent, so nothing is recorded against it. This cannot be undone.`,
      confirmLabel: 'Delete questionnaire',
      tone: 'danger',
    });
    if (yes) del.mutate(t);
  }, [confirm, del]);

  return { archive: archive.mutate, duplicate: duplicate.mutate, remove, busy: archive.isPending || duplicate.isPending || del.isPending, confirmDialog };
}
