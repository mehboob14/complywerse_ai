'use client';

// What can be done to a finding, in one place: hand it to Issues / CAPA, link it to a risk (an existing one, or a new one made from it), give it an owner and a due day, delete it.
// The drill's Findings tab and the Findings register's details panel both use it, so the questions, the words and the refreshing are the same wherever it is done. Every request says
// what happened only after the server answered, in the server's words; creating an issue or a risk in another module and deleting ask first. The rights are the ones the pages have
// always asked: `bcm:findings:edit` for the issue, the risk and the owner and day, `bcm:findings:delete` for the delete (the callers draw only what the person may do).
import { useState, type ReactNode } from 'react';
import { bcmApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { EntityCombobox } from '../_bcm-ui';
import { findingDeleteWords, type Finding } from '../bcmModel';
import { REFRESH_ALL } from '../bcmData';

type Subject = Pick<Finding, 'id' | 'title'>;

/** Choosing the risk and saying so are two steps: a finding cannot be unlinked from a risk here. */
function LinkRiskDialog({ finding, pending, onClose, onLink }: { finding: Subject; pending: boolean; onClose: () => void; onLink: (riskId: number) => void }) {
  const [risk, setRisk] = useState<number | null>(null);
  return (
    <AnimatedModal
      isOpen onClose={onClose} dirty={risk !== null} title="Link a risk" subtitle={truncate(finding.title, 80).text} size="md"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={risk === null} loading={pending} onClick={() => { if (risk !== null) onLink(risk); }}>Link risk</Button>
        </div>
      )}
    >
      <div className="px-[20px] py-[16px]">
        <FormField label="Risk" required hint="Links this finding to a risk that is already in the register. It cannot be unlinked from here.">
          <EntityCombobox kind="risks" label="Risk" placeholder="Choose a risk…" value={risk} onChange={setRisk} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}

export interface FindingActions {
  askIssue: (f: Subject) => Promise<void>;
  askNewRisk: (f: Subject) => Promise<void>;
  startLinkRisk: (f: Subject) => void;
  askDelete: (f: Subject) => Promise<void>;
  /** owner and due day: `ownerId` null = nobody; `due` is a day ("2026-11-30") or '' for none */
  saveWho: (f: Subject, who: { ownerId: number | null; due: string }) => void;
  pending: { issue: number | null; risk: number | null; remove: number | null; who: number | null };
  /** the dialogs these actions open: draw it once, anywhere in the page */
  ui: ReactNode;
}

/** `extraRefresh`: the keys of the page's own record (a drill's ['bcm-drill', id]); every list and the Overview are always refreshed. `onRemoved`: a finding was deleted (close its panel, move focus). */
export function useFindingActions({ extraRefresh = [], onRemoved }: { extraRefresh?: ReadonlyArray<readonly unknown[]>; onRemoved?: (f: Subject) => void } = {}): FindingActions {
  const { confirm, confirmDialog } = useConfirm();
  const [linking, setLinking] = useState<Subject | null>(null);
  const invalidate = [...REFRESH_ALL, ['bcm-drill'], ...extraRefresh];

  const remove = useReportedMutation({
    mutationFn: async (f: Subject) => (await bcmApi.findings.remove(f.id)).data,
    success: 'Finding deleted', failure: "Couldn't delete the finding", invalidate,
    onSuccess: (_data, f) => onRemoved?.(f),
  });
  const makeIssue = useReportedMutation({
    mutationFn: async (f: Subject) => (await bcmApi.findings.createIssue(f.id)).data as Finding,
    success: (f) => ({ title: 'Issue created', message: f?.issue_code ? `Linked to ${f.issue_code}.` : undefined }),
    failure: "Couldn't create the issue", retryable: false, invalidate,
  });
  const linkRisk = useReportedMutation({
    mutationFn: async ({ id, riskId }: { id: number; riskId: number | undefined }) => (await bcmApi.findings.linkRisk(id, { risk_id: riskId })).data,
    success: 'Risk linked', failure: "Couldn't link the risk", retryable: false, invalidate,
  });
  const who = useReportedMutation({
    mutationFn: async ({ f, ownerId, due }: { f: Subject; ownerId: number | null; due: string }) => (await bcmApi.findings.update(f.id, { owner_id: ownerId, due_date: due || null })).data,
    success: 'Finding updated', failure: "Couldn't save the owner and due day", invalidate,
  });

  const askDelete = async (f: Subject) => { if (await confirm({ ...findingDeleteWords(f.title), tone: 'danger' })) remove.mutate(f); };
  const askIssue = async (f: Subject) => {
    const yes = await confirm({
      title: 'Create an issue for this finding?', confirmLabel: 'Create issue',
      message: 'The finding is handed to Issues / CAPA for remediation, and its status is then read from the issue. It cannot be unlinked from here.',
    });
    if (yes) makeIssue.mutate(f);
  };
  const askNewRisk = async (f: Subject) => {
    const yes = await confirm({
      title: 'Create a new risk from this finding?', confirmLabel: 'Create risk',
      message: 'A new risk is added to the Risk Register and linked to this finding. It cannot be unlinked from here.',
    });
    if (yes) linkRisk.mutate({ id: f.id, riskId: undefined });
  };

  return {
    askIssue, askNewRisk, askDelete,
    startLinkRisk: setLinking,
    saveWho: (f, w) => who.mutate({ f, ownerId: w.ownerId, due: w.due }),
    pending: {
      issue: makeIssue.isPending ? makeIssue.variables?.id ?? null : null,
      risk: linkRisk.isPending ? linkRisk.variables?.id ?? null : null,
      remove: remove.isPending ? remove.variables?.id ?? null : null,
      who: who.isPending ? who.variables?.f.id ?? null : null,
    },
    ui: (
      <>
        {linking && (
          <LinkRiskDialog
            finding={linking} pending={linkRisk.isPending} onClose={() => setLinking(null)}
            onLink={(riskId) => linkRisk.mutate({ id: linking.id, riskId }, { onSuccess: () => setLinking(null) })}
          />
        )}
        {confirmDialog}
      </>
    ),
  };
}
