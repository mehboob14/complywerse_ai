'use client';

// Risk Appetite (Risk Management > Risk Appetite): breaches first, configuration second. "Over tolerance" lists the risks above their category's limit, the furthest over first,
// with the number that matters (over by N) and the two next steps (open the risk, add an action). "Appetite by category" is the statement: one row per category with its level,
// tolerance and maximum, how many risks are over, and ONE editor in a side panel (the page had a card editor, a bulk table with its own Save and a third form).
// What counts as over is lib/erm/breach.ts - the Overview's definition, so this page and the Overview agree. A list that did not load is an error with Retry, never an empty
// statement: "Set the defaults" is offered only after a successful load that found no appetite at all.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight, ListPlus, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader, RightSlidePanel } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, FormField, Menu, NoAccessState, Notice, Pager, PersonChip, RegisterTable, SectionCard, Select, StatTile, StatusPill, Textarea, TextInput, useConfirm, useReportedMutation,
  type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, NOT_SET, formatCount, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { breaches, exposureByCategory, limitOf, unconfigured, type AppetiteConfig, type Breach, type CategoryExposure } from '@/lib/erm/breach';
import { categoryLabel, categoryOptions } from '@/lib/erm/categories';
import { appetiteLevel, optionsOf } from '@/lib/statuses/monitoring';
import { ActionForm } from './ActionForm';
import { useLeanRisks, useTenantId } from './lookups';
import { pageSlice, clampPage } from './registerModel';

type Config = AppetiteConfig & { tenant_id: number; escalation_owner_id?: number | null; alert_enabled?: boolean };
const KEY = ['erm-appetite-configs'] as const;
const PAGE = 10;
const LEVELS = ['averse', 'minimal', 'cautious', 'moderate', 'open', 'hungry'] as const;
const MUTED = 'text-ds-fg-muted';
const retryLoad = (failures: number, error: unknown): boolean => canRetry(error) && failures < 3;
const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

const num = (raw: string): number | null | undefined => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 25 ? n : undefined;
};

export default function AppetiteBoard({ label }: { label: string }) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('risks:risk_appetite:create');
  const { confirm, confirmDialog } = useConfirm();
  const tenantId = useTenantId();
  const [editing, setEditing] = useState<{ config: Config | null; category?: string } | undefined>(undefined);
  const [acting, setActing] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const configs = useQuery({ queryKey: KEY, queryFn: async () => (await ermApi.appetite.getAll()).data as Config[], retry: retryLoad });
  const risks = useLeanRisks();
  const list = configs.data ?? [];
  const ready = !!configs.data && !!risks.data;
  const over: Breach[] = useMemo(() => (ready ? breaches(risks.data!.items, list) : []), [ready, risks.data, list]);
  const rows: CategoryExposure[] = useMemo(() => (ready ? exposureByCategory(risks.data!.items, list) : []), [ready, risks.data, list]);
  const without = unconfigured(rows);
  const refused = (configs.isError && statusOf(configs.error) === 403) || (risks.isError && statusOf(risks.error) === 403);

  const create = useReportedMutation({
    mutationFn: async (v: { tenant: number; payload: Record<string, unknown> }) => (await ermApi.appetite.create(v.tenant, v.payload)).data,
    success: 'Appetite saved', failure: "Couldn't save the appetite", retryable: false, invalidate: [KEY as unknown as unknown[]], onSuccess: () => setEditing(undefined),
  });
  const update = useReportedMutation({
    mutationFn: async (v: { id: number; payload: Record<string, unknown> }) => (await ermApi.appetite.update(v.id, v.payload)).data,
    success: 'Appetite saved', failure: "Couldn't save the appetite", retryable: false, invalidate: [KEY as unknown as unknown[]], onSuccess: () => setEditing(undefined),
  });
  const remove = useReportedMutation({
    mutationFn: async (c: Config) => (await ermApi.appetite.delete(c.id)).data,
    success: 'Appetite removed', failure: "Couldn't remove the appetite", invalidate: [KEY as unknown as unknown[]], onSuccess: () => setEditing(undefined),
  });
  const seed = useReportedMutation({
    mutationFn: async () => (await ermApi.appetite.seedDefaults(tenantId ?? undefined)).data,
    success: 'Default appetite set', failure: "Couldn't set the defaults", retryable: false, invalidate: [KEY as unknown as unknown[]],
  });
  const addAction = useReportedMutation({
    mutationFn: async (v: { risk: number; payload: Record<string, unknown> }) => (await ermApi.mitigationActions.create(v.risk, v.payload as never)).data,
    success: { title: 'Action added', message: 'It is in Mitigation Actions.' }, failure: "Couldn't add the action", retryable: false,
    invalidate: [['erm-mitigation-actions', 'all'], ['erm-all-mitigation-actions']], onSuccess: () => setActing(null),
  });

  const askRemove = async (c: Config) => {
    const yes = await confirm({ title: `Remove the appetite for ${categoryLabel(c.category)}?`, message: 'Risks in this category will no longer be rated against a limit, and none will count as over appetite.', confirmLabel: 'Remove appetite', tone: 'danger' });
    if (yes) remove.mutate(c);
  };
  const askSeed = async () => {
    const yes = await confirm({ title: 'Set the default appetite?', message: 'Adds the seven risk categories at a moderate appetite with a limit of 15. You can change each one afterwards.', confirmLabel: 'Set the defaults' });
    if (yes) seed.mutate();
  };

  const overColumns: RegisterColumn<Breach>[] = [
    {
      key: 'risk', header: 'Risk', isRowHeader: true,
      cell: (b) => <Link href={`/erm/risks/${b.risk.id}`} className="inline-flex max-w-full items-center gap-[4px] font-[600] text-ds-fg underline-offset-2 hover:text-ds-primary-text hover:underline"><span className="line-clamp-2 break-words" title={b.risk.title}>{b.risk.title}</span><ArrowUpRight aria-hidden size={14} className="shrink-0" /></Link>,
    },
    { key: 'category', header: 'Category', width: 'w-[140px]', card: 'meta', cell: (b) => <span className="text-ds-body text-ds-fg-body">{categoryLabel(b.category)}</span> },
    { key: 'score', header: 'Residual vs limit', width: 'w-[150px]', card: 'meta', cell: (b) => <span className="whitespace-nowrap tabular-nums text-ds-body text-ds-fg">{`${b.score} vs ${b.limit}`}</span> },
    { key: 'over', header: 'Over by', width: 'w-[96px]', align: 'right', card: 'meta', cell: (b) => <span className="whitespace-nowrap font-[600] tabular-nums text-ds-danger">{`+${Math.round(b.over * 10) / 10}`}</span> },
    { key: 'owner', header: 'Owner', width: 'w-[170px]', priority: 2, card: 'meta', cell: (b) => <PersonChip name={b.risk.owner_name} /> },
    { key: 'act', header: 'Next step', width: 'w-[140px]', align: 'right', cell: (b) => <Button size="sm" leftIcon={<ListPlus aria-hidden />} onClick={() => setActing(b.risk.id)}>Add action</Button> },
  ];
  const levelCell = (c: CategoryExposure) => (c.config ? <StatusPill size="sm" {...statusPill(appetiteLevel, c.config.appetite_level)} /> : <span className={`text-ds-body ${MUTED}`}>{NOT_SET}</span>);
  const catColumns: RegisterColumn<CategoryExposure>[] = [
    { key: 'category', header: 'Category', isRowHeader: true, cell: (c) => <span className="font-[600] text-ds-fg">{categoryLabel(c.category)}</span> },
    { key: 'level', header: 'Appetite', width: 'w-[130px]', card: 'meta', cell: levelCell },
    { key: 'limit', header: 'Limit', width: 'w-[80px]', align: 'right', card: 'meta', cell: (c) => <span className={`tabular-nums text-ds-body ${c.limit == null ? MUTED : 'text-ds-fg'}`}>{c.limit ?? EMPTY}</span> },
    { key: 'tolerance', header: 'Tolerance', width: 'w-[96px]', align: 'right', priority: 2, cardLabel: 'Tolerance', card: 'meta', cell: (c) => <span className={`tabular-nums text-ds-body ${MUTED}`}>{c.config?.tolerance_threshold ?? EMPTY}</span> },
    { key: 'max', header: 'Maximum', width: 'w-[96px]', align: 'right', priority: 2, card: 'meta', cell: (c) => <span className={`tabular-nums text-ds-body ${MUTED}`}>{c.config?.max_acceptable_score ?? EMPTY}</span> },
    { key: 'risks', header: 'Active risks', width: 'w-[110px]', align: 'right', card: 'meta', cell: (c) => <span className="tabular-nums text-ds-body text-ds-fg-body">{formatCount(c.active)}</span> },
    { key: 'over', header: 'Over', width: 'w-[80px]', align: 'right', card: 'meta', cell: (c) => (c.config ? <span className={`tabular-nums text-ds-body ${c.over ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>{formatCount(c.over)}</span> : <span className={`text-ds-body ${MUTED}`}>{EMPTY}</span>) },
    {
      key: 'edit', header: 'Edit', width: 'w-[120px]', align: 'right',
      cell: (c) => (c.config
        ? <Button size="sm" leftIcon={<Pencil aria-hidden />} onClick={() => setEditing({ config: c.config as Config })}>Edit</Button>
        : canCreate ? <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => setEditing({ config: null, category: c.category })}>Set appetite</Button> : null),
    },
  ];

  const head = (
    <PageHeader
      variant="page"
      title={label}
      info="How much risk the organisation accepts, by category. A risk is over appetite when its residual score is above its category's limit (the tolerance, else the maximum, else 12); the Overview counts the same ones."
      meta={ready ? `${formatCount(list.length)} ${list.length === 1 ? 'category' : 'categories'} set` : undefined}
      actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing({ config: null })}>New category</Button> : undefined}
    />
  );
  if (refused) return <div className="flex flex-col gap-[16px]">{head}<NoAccessState title="You don't have access to risk appetite" reason={errorMessage(configs.error ?? risks.error)} /></div>;

  const loadError = (q: { isError: boolean; error: unknown; refetch: () => unknown }, name: string) => (q.isError ? { message: `${errorMessage(q.error)} The ${name} could not be read.`, onRetry: () => { void q.refetch(); } } : null);
  const failed = loadError(configs, 'appetite settings') ?? loadError(risks, 'risks');
  const pages = clampPage(page, over.length, PAGE);
  const configsLoaded = !!configs.data;
  const noAppetiteAtAll = configsLoaded && list.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      {head}
      <div className="grid grid-cols-2 gap-[12px]">
        <StatTile label="Over tolerance" value={ready ? formatCount(over.length) : null} loading={!ready && !failed} error={failed ? { title: 'Not available', message: failed.message, onRetry: failed.onRetry } : null} tone={over.length ? 'danger' : undefined} note={ready ? (over.length ? 'risks above their category limit' : 'every scored risk is within its limit') : undefined} />
        <StatTile label="Categories without appetite" value={ready ? formatCount(without.length) : null} loading={!ready && !failed} error={failed ? { title: 'Not available', message: failed.message, onRetry: failed.onRetry } : null} tone={without.length ? 'warning' : undefined} note={ready ? (without.length ? 'have risks but no limit' : 'all categories with risks are set') : undefined} />
      </div>

      {noAppetiteAtAll ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState bare kind="firstUse" title="No appetite is set yet" description="Without it no risk can be over appetite. Start from the seven default categories, or add one yourself."
            action={canCreate ? (
              <span className="flex flex-wrap justify-center gap-[8px]">
                <Button variant="primary" loading={seed.isPending} onClick={() => { void askSeed(); }}>Set the defaults</Button>
                <Button leftIcon={<Plus aria-hidden />} onClick={() => setEditing({ config: null })}>New category</Button>
              </span>
            ) : undefined} />
        </div>
      ) : (
        <>
          <SectionCard id="over" title="Over tolerance" info="Risks whose residual score is above the limit of their category, furthest over first. Closed and unscored risks are not counted." meta={ready ? `${formatCount(over.length)} ${over.length === 1 ? 'risk' : 'risks'}` : undefined}>
            <RegisterTable
              caption="Risks over tolerance, furthest over first"
              columns={overColumns}
              rows={pageSlice(over, pages, PAGE)}
              getRowId={(b) => b.risk.id}
              loading={!ready && !failed}
              error={failed}
              empty={<EmptyState bare kind="firstUse" title="Nothing is over tolerance" description="Every scored risk in a category with an appetite is within its limit." />}
              cardTitle={(b) => <Link href={`/erm/risks/${b.risk.id}`} className="font-[600] text-ds-fg underline-offset-2 hover:underline">{truncate(b.risk.title, 90).text}</Link>}
              cardActions={(b) => <Menu iconOnly label={`Actions for ${truncate(b.risk.title, 60).text}`} items={[{ key: 'add', label: 'Add action', icon: ListPlus, onSelect: () => setActing(b.risk.id) }]} />}
              footer={over.length > PAGE ? <Pager page={pages} pageSize={PAGE} total={over.length} onPage={setPage} noun={{ one: 'risk', other: 'risks' }} /> : undefined}
            />
          </SectionCard>

          <SectionCard id="categories" title="Appetite by category" info="The statement: how much risk the organisation will carry in each category. The limit is what a risk's residual score is held against." meta={ready ? `${formatCount(rows.length)} categories` : undefined}>
            {without.length > 0 && ready && (
              <Notice tone="warning" title={`${formatCount(without.length)} ${without.length === 1 ? 'category has' : 'categories have'} risks and no appetite`}>
                {`${without.map((c) => categoryLabel(c.category)).join(', ')}. Risks there cannot be over appetite until a limit is set.`}
              </Notice>
            )}
            <div className={without.length > 0 && ready ? 'mt-[12px]' : undefined}>
              <RegisterTable
                caption="Appetite by category"
                columns={catColumns}
                rows={rows}
                getRowId={(c) => c.category}
                loading={!ready && !failed}
                error={failed}
                empty={<EmptyState bare kind="firstUse" title="No categories yet" />}
                cardTitle={(c) => <span className="font-[600] text-ds-fg">{categoryLabel(c.category)}</span>}
                cardActions={(c) => (c.config
                  ? <Menu iconOnly label={`Actions for ${categoryLabel(c.category)}`} items={[{ key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing({ config: c.config as Config }) }]} />
                  : canCreate ? <Menu iconOnly label={`Actions for ${categoryLabel(c.category)}`} items={[{ key: 'set', label: 'Set appetite', icon: Plus, onSelect: () => setEditing({ config: null, category: c.category }) }]} /> : null)}
              />
            </div>
          </SectionCard>
        </>
      )}

      {editing !== undefined && (
        <AppetiteEditor
          key={editing.config?.id ?? editing.category ?? 'new'}
          config={editing.config} category={editing.category} categories={categoryOptions(rows.map((r) => r.category))} taken={list.map((c) => c.category)}
          saving={create.isPending || update.isPending} removing={remove.isPending} tenantKnown={tenantId != null} onClose={() => setEditing(undefined)}
          onRemove={editing.config ? () => { void askRemove(editing.config as Config); } : undefined}
          onSubmit={(payload) => (editing.config ? update.mutate({ id: editing.config.id, payload }) : tenantId != null && create.mutate({ tenant: tenantId, payload }))}
        />
      )}
      {acting != null && (
        <ActionForm action={null} risk={acting} saving={addAction.isPending} onClose={() => setActing(null)} onSubmit={(risk, payload) => addAction.mutate({ risk, payload })} />
      )}
      {confirmDialog}
    </div>
  );
}

function AppetiteEditor({ config, category, categories, taken, saving, removing, tenantKnown, onClose, onRemove, onSubmit }: {
  config: Config | null; category?: string; categories: Array<{ value: string; label: string }>; taken: string[]; saving: boolean; removing: boolean; tenantKnown: boolean;
  onClose: () => void; onRemove?: () => void; onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const isNew = config === null;
  const [opened] = useState(() => ({
    category: config?.category ?? category ?? '', level: config?.appetite_level ?? 'moderate', tolerance: config?.tolerance_threshold != null ? String(config.tolerance_threshold) : '',
    max: config?.max_acceptable_score != null ? String(config.max_acceptable_score) : '', description: config?.description ?? '',
  }));
  const [d, setD] = useState(opened);
  const [tried, setTried] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const set = <K extends keyof typeof d>(key: K, value: (typeof d)[K]) => setD((x) => ({ ...x, [key]: value }));
  const suggest = useReportedMutation({
    mutationFn: async () => (await ermApi.appetite.aiSuggest({ category: d.category, description: d.description || undefined })).data,
    success: 'Suggestion ready', failure: "Couldn't get a suggestion", toast: 'none',
    onSuccess: (s) => {
      setD((x) => ({ ...x, level: (LEVELS as readonly string[]).includes(s.appetite_level) ? s.appetite_level : x.level, tolerance: String(s.tolerance_threshold ?? ''), max: String(s.max_acceptable_score ?? ''), description: s.description || x.description }));
      setAiNote(s.rationale || 'The AI filled the form. Check it before saving.');
    },
  });
  const tolerance = num(d.tolerance);
  const max = num(d.max);
  const errors = {
    category: tried && !d.category ? 'Choose a category.' : tried && isNew && taken.includes(d.category) ? 'This category already has an appetite. Edit it instead.' : undefined,
    tolerance: tolerance === undefined ? 'Enter a score from 0 to 25.' : undefined,
    max: max === undefined ? 'Enter a score from 0 to 25.' : undefined,
  };
  const dirty = (Object.keys(opened) as Array<keyof typeof d>).some((k) => opened[k] !== d[k]);
  const limit = limitOf({ tolerance_threshold: tolerance ?? null, max_acceptable_score: max ?? null });
  const submit = () => {
    setTried(true);
    if (!d.category || (isNew && taken.includes(d.category)) || tolerance === undefined || max === undefined) return;
    onSubmit({
      ...(isNew ? { category: d.category } : {}), appetite_level: d.level, tolerance_threshold: tolerance,
      ...(max !== null ? { max_acceptable_score: max } : {}), description: d.description || null,
    });
  };
  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={isNew ? 'Set appetite' : `Appetite: ${categoryLabel(config!.category)}`}
      footer={(
        <div className="flex items-center gap-[8px]">
          {onRemove && <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={removing} onClick={onRemove}>Remove</Button>}
          <span className="ml-auto flex gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={isNew && !tenantKnown} onClick={submit}>Save</Button></span>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {isNew && !tenantKnown && <Notice tone="warning">Your organisation could not be identified, so a new category cannot be saved yet. Reload the page.</Notice>}
        <FormField label="Category" required error={errors.category}>
          <Select value={d.category} disabled={!isNew || !!category} onChange={(e) => set('category', e.target.value)} placeholder="Choose a category">
            {categories.map((c) => <option key={c.value} value={c.value} disabled={isNew && taken.includes(c.value)}>{c.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Appetite level">
          <Select value={d.level} onChange={(e) => set('level', e.target.value)}>{optionsOf(appetiteLevel, LEVELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </FormField>
        <div className={ROW2}>
          <FormField label="Tolerance" optional error={errors.tolerance} info="The score above which a risk is over appetite."><TextInput type="number" inputMode="decimal" min={0} max={25} step="any" value={d.tolerance} onChange={(e) => set('tolerance', e.target.value)} /></FormField>
          <FormField label="Maximum acceptable" optional error={errors.max} info="Used as the limit when no tolerance is set."><TextInput type="number" inputMode="decimal" min={0} max={25} step="any" value={d.max} onChange={(e) => set('max', e.target.value)} /></FormField>
        </div>
        <p className="text-ds-label text-ds-fg-muted">{`Risks in this category are held to a limit of ${limit}. The tolerance is used first, then the maximum, then 12.`}</p>
        <FormField label="Statement" optional><Textarea rows={4} value={d.description} onChange={(e) => set('description', e.target.value)} /></FormField>
        <div className="flex flex-wrap items-center gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
          <p className="min-w-0 flex-1 text-ds-body text-ds-fg-body">Let the AI suggest a level and limits for this category.</p>
          <Button leftIcon={<Sparkles aria-hidden />} loading={suggest.isPending} disabled={!d.category} onClick={() => suggest.mutate()}>AI suggest</Button>
        </div>
        {suggest.isError && <ErrorState compact title="The AI could not make a suggestion right now" message="Try again in a moment, or fill the form yourself." />}
        {aiNote && <Notice tone="info">{aiNote}</Notice>}
      </div>
    </RightSlidePanel>
  );
}
