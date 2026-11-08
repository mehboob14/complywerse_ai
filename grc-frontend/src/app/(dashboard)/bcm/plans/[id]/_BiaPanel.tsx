'use client';

// One business impact analysis process, as the right-hand panel of the plan's "Business impact analysis" tab (it was a drawer over the page): the risk it is linked to, the IT assets it
// depends on, its dependencies (a vendor's own continuity plan included) and its recovery strategies (approved or rejected here), with Edit process and Delete process in its head. Every
// request is the one the drawer always made, with the same keys; each says what happened only after the server answered, in the server's words, and a delete asks first and says what goes.
// The rights are the server's: `bcm:bia:edit` adds, links and approves, `bcm:bia:delete` removes (the drawer offered the trash can to anyone who could edit, and the server answered 403).
// It tells the page when it holds typing that would be lost (an unsent dependency or strategy, an unsaved asset choice), so choosing another process can ask first.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { formatDate, truncate } from '@/lib/format';
import { dependencyType, externalBcp, optionsOf, severity, strategyStatus, strategyType } from '@/lib/statuses/bcm';
import { Button, FormField, IconButton, Notice, Select, StatusPill, Textarea, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { AssetMultiSelect, ChipList, ClampedText, EntityCombobox, FormProblem, LABEL_LINK, Pill } from '../../_bcm-ui';
import { REFRESH_ALL } from '../../bcmData';
import {
  NAME_MAX, biaCompleteness, biaDeleteWords, blankDependencyForm, blankStrategyForm, dependencyDeleteWords, dependencyErrors, dependencyPayload, fmtHours, strategyDeleteWords, strategyPayload,
  type Bia, type Dependency, type DependencyForm, type Strategy, type StrategyForm,
} from '../../bcmModel';

const SHOWN_DEPENDENCIES = 10;
const BOX = 'rounded-ds-control border border-ds-border px-[12px] py-[8px]';
const MUTED_LINE = 'text-ds-label font-normal text-ds-fg-muted';

/** A block of the panel: its heading with the count and the person's action, then the content. The heading takes `!` (the platform CSS remaps a bare h3). */
function Block({ id, title, count, actions, children }: { id: string; title: string; count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <h3 id={`${id}-h`} className="min-w-0 break-words !text-ds-body !font-[600] !text-ds-fg">
          {title}{count !== undefined && <span className="ml-[6px] font-normal text-ds-fg-muted">{`(${count})`}</span>}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface BiaPanelProps {
  bia: Bia;
  planId: number;
  /** adds, links and approves (`bcm:bia:edit`) */
  canEdit: boolean;
  /** removes a dependency or a strategy, or the process itself (`bcm:bia:delete`) */
  canDelete: boolean;
  onEdit: () => void;
  onDeleted: () => void;
  /** whether the panel holds typing that would be lost */
  onDirty: (dirty: boolean) => void;
}

export function BiaPanel({ bia, planId, canEdit, canDelete, onEdit, onDeleted, onDirty }: BiaPanelProps) {
  const { confirm, confirmDialog } = useConfirm();
  const refresh = [['bcm-plan', planId], ...REFRESH_ALL];

  const [depOpen, setDepOpen] = useState(false);
  const [dep, setDep] = useState<DependencyForm>(blankDependencyForm);
  const [depShowErrors, setDepShowErrors] = useState(false);
  const [depProblem, setDepProblem] = useState<string | null>(null);
  const [allDeps, setAllDeps] = useState(false);
  const [riskDraft, setRiskDraft] = useState<number | null>(null);
  const [stratOpen, setStratOpen] = useState(false);
  const [strat, setStrat] = useState<StrategyForm>(blankStrategyForm);
  const [stratProblem, setStratProblem] = useState<string | null>(null);
  const saved = bia.linked_asset_ids ?? [];
  const savedKey = JSON.stringify(saved.slice().sort((a, b) => a - b));
  const [assets, setAssets] = useState<number[]>(saved);
  useEffect(() => { setAssets(JSON.parse(savedKey) as number[]); }, [savedKey]);          // after a save (or a refresh by someone else) the picker holds what is stored
  const assetsChanged = JSON.stringify(assets.slice().sort((a, b) => a - b)) !== savedKey;
  const addDepButton = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const addStratButton = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  const dirty = assetsChanged || riskDraft !== null || (depOpen && (dep.name !== '' || dep.external_bcp_status !== '')) || (stratOpen && strat.description !== '');
  useEffect(() => { onDirty(dirty); }, [dirty]);                    // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty(false), []);                        // eslint-disable-line react-hooks/exhaustive-deps

  const addDep = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof dependencyPayload>) => (await bcmApi.bia.addDependency(bia.id, payload)).data,
    success: 'Dependency added', failure: "Couldn't add the dependency", retryable: false, toast: 'success', invalidate: refresh,
    onSuccess: () => { setDepOpen(false); setDep(blankDependencyForm()); setDepProblem(null); setDepShowErrors(false); },
    onError: (error) => setDepProblem(errorMessage(error)),
  });
  const delDep = useReportedMutation({
    mutationFn: async (d: Dependency) => (await bcmApi.dependencies.remove(d.id)).data,
    success: 'Dependency removed', failure: "Couldn't remove the dependency", invalidate: refresh,
    onSuccess: () => addDepButton.current?.focus(),                       // the row the person was on is gone, and focus with it
  });
  const addStrat = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof strategyPayload>) => (await bcmApi.bia.addStrategy(bia.id, payload)).data,
    success: 'Recovery strategy added', failure: "Couldn't add the strategy", retryable: false, toast: 'success', invalidate: refresh,
    onSuccess: () => { setStratOpen(false); setStrat(blankStrategyForm()); setStratProblem(null); },
    onError: (error) => setStratProblem(errorMessage(error)),
  });
  const decide = useReportedMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => (await bcmApi.strategies.update(id, { status })).data,
    success: (_data, v) => `Strategy ${v.status}`, failure: "Couldn't update the strategy", invalidate: refresh,
  });
  const delStrat = useReportedMutation({
    mutationFn: async (s: Strategy) => (await bcmApi.strategies.remove(s.id)).data,
    success: 'Strategy removed', failure: "Couldn't remove the strategy", invalidate: refresh,
    onSuccess: () => addStratButton.current?.focus(),
  });
  const linkRisk = useReportedMutation({
    mutationFn: async (riskId: number | undefined) => (await bcmApi.bia.linkRisk(bia.id, { risk_id: riskId })).data,
    success: 'Risk linked', failure: "Couldn't link the risk", retryable: false, invalidate: refresh,
    onSuccess: () => setRiskDraft(null),
  });
  const saveAssets = useReportedMutation({
    mutationFn: async (ids: number[]) => (await bcmApi.bia.update(bia.id, { linked_asset_ids: ids })).data,
    success: 'Linked assets updated', failure: "Couldn't update the assets", invalidate: refresh,
  });
  const removeBia = useReportedMutation({
    mutationFn: async () => (await bcmApi.bia.remove(bia.id)).data,
    success: 'Process deleted', failure: "Couldn't delete the process", invalidate: refresh,
    onSuccess: () => onDeleted(),
  });

  const askNewRisk = async () => {
    const yes = await confirm({
      title: 'Create a new risk from this process?', confirmLabel: 'Create risk',
      message: 'A new risk is added to the Risk Register and linked to this process. It cannot be unlinked from here.',
    });
    if (yes) linkRisk.mutate(undefined);
  };
  const askRemoveDependency = async (d: Dependency) => { if (await confirm({ ...dependencyDeleteWords(d.name), tone: 'danger' })) delDep.mutate(d); };
  const askDeleteStrategy = async (s: Strategy) => { if (await confirm({ ...strategyDeleteWords(strategyType.label(s.strategy_type)), tone: 'danger' })) delStrat.mutate(s); };
  const askDeleteProcess = async () => { if (await confirm({ ...biaDeleteWords(bia), tone: 'danger' })) removeBia.mutate(); };

  const submitDependency = () => {
    setDepProblem(null);
    if (Object.keys(dependencyErrors(dep)).length > 0) { setDepShowErrors(true); return; }
    addDep.mutate(dependencyPayload(dep));
  };

  const dependencies = bia.dependencies ?? [];
  const strategies = bia.recovery_strategies ?? [];
  const linkedAssets = bia.linked_assets ?? [];
  const shownDependencies = allDeps ? dependencies : dependencies.slice(0, SHOWN_DEPENDENCIES);
  const done = biaCompleteness(bia);

  return (
    <div className="flex min-w-0 flex-col gap-[20px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[8px]">
        <div className="min-w-0 flex-1 basis-[14rem]">
          <h3 className="m-0 break-words !text-ds-section !font-[600] !text-ds-fg [overflow-wrap:anywhere]">{bia.process_name}</h3>
          <p className={`m-0 mt-[2px] ${MUTED_LINE}`}>{`RTO ${fmtHours(bia.rto_hours)} · RPO ${fmtHours(bia.rpo_hours)} · MTPD ${fmtHours(bia.mtpd_hours)}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          {canEdit && <Button leftIcon={<Pencil aria-hidden />} onClick={onEdit}>Edit process</Button>}
          {canDelete && <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={removeBia.isPending} onClick={() => { void askDeleteProcess(); }}>Delete</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Pill registry={severity} word={bia.criticality_rating} size="md" />
        <StatusPill size="md" tone={done.complete ? 'success' : 'warning'} label={done.complete ? 'Recovery strategy in place' : done.label} />
      </div>
      {bia.description && <ClampedText text={bia.description} />}

      {/* Risk register */}
      <Block id="bia-risk" title="Risk register">
        {bia.linked_risk_id ? (
          <div className={`${BOX} flex items-center justify-between gap-[8px] bg-ds-surface-subtle`}>
            <span className="min-w-0 break-words text-ds-body font-[500] text-ds-fg">{bia.linked_risk_title || 'A linked risk'}</span>
            <Link href={`/erm/risks/${bia.linked_risk_id}`} className={`inline-flex shrink-0 items-center gap-[4px] text-ds-label ${LABEL_LINK}`}>Open <ExternalLink aria-hidden size={14} /></Link>
          </div>
        ) : canEdit ? (
          <div className="flex flex-col gap-[8px]">
            {(bia.criticality_rating === 'critical' || bia.criticality_rating === 'high') && <Notice tone="warning">Critical or high process: link it to the register.</Notice>}
            <EntityCombobox kind="risks" label="Link an existing risk" placeholder="Link an existing risk…" value={riskDraft} onChange={setRiskDraft} clearable />
            <div className="flex flex-wrap items-center gap-[8px]">
              <Button size="sm" variant="primary" disabled={riskDraft === null} loading={linkRisk.isPending && riskDraft !== null} onClick={() => { if (riskDraft !== null) linkRisk.mutate(riskDraft); }}>Link risk</Button>
              <Button size="sm" variant="link" leftIcon={<Plus aria-hidden />} onClick={() => { void askNewRisk(); }}>Create a new risk from this process</Button>
            </div>
          </div>
        ) : (
          <p className="m-0 text-ds-body text-ds-fg-muted">No risk linked.</p>
        )}
      </Block>

      {/* Linked IT assets */}
      <Block id="bia-assets" title="Linked assets" count={linkedAssets.length}>
        {canEdit ? (
          <div className="flex flex-col gap-[8px]">
            <AssetMultiSelect value={assets} onChange={setAssets} extra={linkedAssets.map((a) => ({ value: a.id, label: a.name, subLabel: a.asset_type }))} />
            {assetsChanged && (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button size="sm" variant="primary" loading={saveAssets.isPending} onClick={() => saveAssets.mutate(assets)}>Save linked assets</Button>
                <Button size="sm" disabled={saveAssets.isPending} onClick={() => setAssets(JSON.parse(savedKey) as number[])}>Reset</Button>
              </div>
            )}
          </div>
        ) : linkedAssets.length > 0 ? (
          <ChipList items={linkedAssets.map((a) => a.name)} label="Linked assets" />
        ) : (
          <p className="m-0 text-ds-body text-ds-fg-muted">No assets linked.</p>
        )}
      </Block>

      {/* Dependencies */}
      <Block
        id="bia-deps" title="Dependencies" count={dependencies.length}
        actions={canEdit ? <Button ref={addDepButton} size="sm" leftIcon={<Plus aria-hidden />} aria-expanded={depOpen} onClick={() => setDepOpen((v) => !v)}>Add</Button> : undefined}
      >
        {depOpen && (
          <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <FormProblem message={depProblem} />
            <div className="grid gap-[12px] sm:grid-cols-2">
              <FormField label="Type">
                <Select value={dep.dependency_type} onChange={(e) => setDep({ ...dep, dependency_type: e.target.value })}>
                  {optionsOf(dependencyType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </FormField>
              <FormField label="Criticality">
                <Select value={dep.criticality} onChange={(e) => setDep({ ...dep, criticality: e.target.value })}>
                  {optionsOf(severity).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </FormField>
            </div>
            <FormField label="Name" required error={depShowErrors ? dependencyErrors(dep).name : undefined}>
              <TextInput value={dep.name} maxLength={NAME_MAX} placeholder="Named system / vendor / role / site" onChange={(e) => setDep({ ...dep, name: e.target.value })} />
            </FormField>
            {dep.dependency_type === 'vendor' && (
              <FormField label="Vendor BCP status" info="Whether the vendor has its own business continuity plan. Left as it is, it is saved as BCP Requested.">
                <Select value={dep.external_bcp_status} placeholder="BCP Requested (default)" onChange={(e) => setDep({ ...dep, external_bcp_status: e.target.value })}>
                  {optionsOf(externalBcp).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </FormField>
            )}
            <div className="flex justify-end gap-[8px]">
              <Button size="sm" onClick={() => { setDepOpen(false); setDepProblem(null); setDepShowErrors(false); }}>Cancel</Button>
              <Button size="sm" variant="primary" loading={addDep.isPending} onClick={submitDependency}>Add dependency</Button>
            </div>
          </div>
        )}
        {dependencies.length === 0 ? (
          <p className="m-0 text-ds-body text-ds-fg-muted">No dependencies recorded.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {shownDependencies.map((d) => (
              <li key={d.id} className={`${BOX} flex items-start justify-between gap-[8px]`}>
                <div className="min-w-0 flex-1">
                  <p className="m-0 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{d.name}</p>
                  <p className={`m-0 mt-[2px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] ${MUTED_LINE}`}>
                    <span>{dependencyType.label(d.dependency_type)}</span>
                    {d.external_bcp_status && <span>{externalBcp.label(d.external_bcp_status)}</span>}
                    {d.criticality && <Pill registry={severity} word={d.criticality} />}
                  </p>
                </div>
                {canDelete && <IconButton label={`Remove dependency ${truncate(d.name, 60).text}`} onClick={() => { void askRemoveDependency(d); }}><Trash2 aria-hidden /></IconButton>}
              </li>
            ))}
            {dependencies.length > SHOWN_DEPENDENCIES && (
              <li>
                <Button size="sm" variant="link" aria-expanded={allDeps} onClick={() => setAllDeps((v) => !v)}>{allDeps ? 'Show fewer' : `Show all ${dependencies.length}`}</Button>
              </li>
            )}
          </ul>
        )}
      </Block>

      {/* Recovery strategies */}
      <Block
        id="bia-strategies" title="Recovery strategies" count={strategies.length}
        actions={canEdit ? <Button ref={addStratButton} size="sm" leftIcon={<Plus aria-hidden />} aria-expanded={stratOpen} onClick={() => setStratOpen((v) => !v)}>Add</Button> : undefined}
      >
        {stratOpen && (
          <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <FormProblem message={stratProblem} />
            <FormField label="Strategy type">
              <Select value={strat.strategy_type} onChange={(e) => setStrat({ ...strat, strategy_type: e.target.value })}>
                {optionsOf(strategyType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
            <FormField label="How this process is recovered" optional>
              <Textarea rows={3} value={strat.description} onChange={(e) => setStrat({ ...strat, description: e.target.value })} />
            </FormField>
            <div className="flex justify-end gap-[8px]">
              <Button size="sm" onClick={() => { setStratOpen(false); setStratProblem(null); }}>Cancel</Button>
              <Button size="sm" variant="primary" loading={addStrat.isPending} onClick={() => { setStratProblem(null); addStrat.mutate(strategyPayload(strat)); }}>Add strategy</Button>
            </div>
          </div>
        )}
        {strategies.length === 0 ? (
          <p className="m-0 text-ds-body text-ds-fg-muted">No recovery strategies. Add at least one to complete this process.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {strategies.map((s) => (
              <li key={s.id} className={BOX}>
                <div className="flex items-start justify-between gap-[8px]">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                    <p className="m-0 text-ds-body font-[500] text-ds-fg">{strategyType.label(s.strategy_type)}</p>
                    <Pill registry={strategyStatus} word={s.status} />
                  </div>
                  {canDelete && <IconButton label={`Delete the ${strategyType.label(s.strategy_type)} strategy`} onClick={() => { void askDeleteStrategy(s); }}><Trash2 aria-hidden /></IconButton>}
                </div>
                {s.description && <ClampedText text={s.description} max={200} className="mt-[4px]" />}
                {s.status === 'approved' && s.approved_by_name && <p className={`m-0 mt-[4px] ${MUTED_LINE}`}>{`Approved by ${s.approved_by_name}${s.approved_date ? ` on ${formatDate(s.approved_date)}` : ''}`}</p>}
                {s.review_comments && <p className={`m-0 mt-[4px] break-words ${MUTED_LINE}`}>{`Review note: ${s.review_comments}`}</p>}
                {canEdit && s.status === 'proposed' && (
                  <div className="mt-[8px] flex flex-wrap gap-[8px]">
                    <Button size="sm" leftIcon={<Check aria-hidden />} onClick={() => decide.mutate({ id: s.id, status: 'approved' })}>Approve</Button>
                    <Button size="sm" variant="dangerOutline" leftIcon={<X aria-hidden />} onClick={() => decide.mutate({ id: s.id, status: 'rejected' })}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Block>
      {confirmDialog}
    </div>
  );
}
