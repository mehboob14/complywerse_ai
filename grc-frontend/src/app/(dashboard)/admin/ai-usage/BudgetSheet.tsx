'use client';

// Token budgets and quota: the monthly limits behind the alert, the budget bars and the month-end projection. A Sheet with a form; the quota and the budgets are typed in
// millions of tokens (usageModel.ts turns them into whole tokens on save). Saving needs admin:organization:edit (the server checks it): without it the sheet is read-only and
// says so. A save that fails is said in the server's words with a Retry, and the sheet stays open with what was typed.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type TokenBudgets } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Button, ErrorState, FormField, ReadOnlyNote, Sheet, SkeletonLines, TextInput, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { budgetDirty, budgetErrors, budgetForm, budgetPayload, hasBudgetErrors, type BudgetForm } from './usageModel';

const EDIT_RIGHT = 'admin:organization:edit';

export function BudgetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { hasPermission, isAdmin, isLoading: rightsLoading } = usePermissions();
  const canEdit = !rightsLoading && (isAdmin || hasPermission(EDIT_RIGHT));
  const budgets = useQuery({ queryKey: ['admin-token-budgets'], enabled: open, queryFn: async () => (await adminApi.getTokenBudgets()).data as TokenBudgets });
  const saved = useMemo(() => (budgets.data ? budgetForm(budgets.data) : null), [budgets.data]);
  const [draft, setDraft] = useState<BudgetForm | null>(null);
  useEffect(() => { if (!open) setDraft(null); }, [open]);
  const form = draft ?? saved;
  const errors = form ? budgetErrors(form) : null;
  const dirty = !!saved && !!draft && budgetDirty(saved, draft);

  const save = useReportedMutation({
    mutationFn: () => adminApi.updateTokenBudgets(budgetPayload(draft as BudgetForm, budgets.data as TokenBudgets)),
    success: 'Budgets saved',
    failure: "The budgets weren't saved",
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['admin-token-budgets'] });
      void qc.invalidateQueries({ queryKey: ['admin-token-usage'] });
      onClose();
    },
  });

  const set = (patch: Partial<BudgetForm>) => form && setDraft({ ...form, ...patch });
  const setModule = (key: string, value: string) => form && setDraft({ ...form, modules: { ...form.modules, [key]: value } });
  const readOnly = !canEdit;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="md"
      title="Token budgets and quota"
      subtitle={readOnly && !rightsLoading ? <ReadOnlyNote>View only</ReadOnlyNote> : 'Monthly limits behind the alert, the budget bars and the month-end projection.'}
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && (
            <Button variant="primary" loading={save.isPending} disabled={!dirty || !errors || hasBudgetErrors(errors)} onClick={() => save.mutate()}>Save budgets</Button>
          )}
        </div>
      )}
    >
      {budgets.isError ? (
        <ErrorState title="Couldn't open the budgets" message={errorMessage(budgets.error)} onRetry={canRetry(budgets.error) ? () => { void budgets.refetch(); } : undefined} />
      ) : !form || !errors || !budgets.data ? (
        <SkeletonLines lines={6} label="Loading the budgets" />
      ) : (
        <div className="flex flex-col gap-[16px]">
          <div className="grid gap-[12px] sm:grid-cols-2">
            <FormField label="Monthly quota" info="The most tokens the organisation plans to use in a billing cycle, in millions." error={errors.quotaM}>
              <TextInput type="number" inputMode="decimal" min={0} step="any" unit="M tokens" readOnly={readOnly} value={form.quotaM} onChange={(e) => set({ quotaM: e.target.value })} />
            </FormField>
            <FormField label="Blended rate" info="What one million tokens cost on average. It turns tokens into the estimated cost." error={errors.rate}>
              <TextInput type="number" inputMode="decimal" min={0} step="any" unit="$ per 1M" readOnly={readOnly} value={form.rate} onChange={(e) => set({ rate: e.target.value })} />
            </FormField>
            <FormField label="Billing cycle starts on day" info="Budgets reset on this day of the month (1 to 28)." error={errors.cycleDay}>
              <TextInput type="number" inputMode="numeric" min={1} max={28} step={1} readOnly={readOnly} value={form.cycleDay} onChange={(e) => set({ cycleDay: e.target.value })} />
            </FormField>
          </div>

          <section aria-labelledby="budget-modules-h">
            <h3 id="budget-modules-h" className="m-0 mb-[8px] !text-ds-section !text-ds-fg">Budget for each module</h3>
            {budgets.data.modules.length === 0 ? (
              <p className="m-0 text-ds-body text-ds-fg-muted">Modules appear here once they have used AI. Budgets can be set after that.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
                {budgets.data.modules.map((m) => (
                  <li key={m.module_key} className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[4px]">
                    <span className="flex min-h-ds-control items-center gap-[8px] text-ds-body text-ds-fg">
                      <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: m.color }} />
                      {m.label}
                    </span>
                    <FormField label={<span className="sr-only">{`Monthly budget for ${m.label}`}</span>} error={errors.modules[m.module_key]} className="w-[170px]">
                      <TextInput type="number" inputMode="decimal" min={0} step="any" unit="M tokens" readOnly={readOnly} value={form.modules[m.module_key] ?? ''} onChange={(e) => setModule(m.module_key, e.target.value)} />
                    </FormField>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
