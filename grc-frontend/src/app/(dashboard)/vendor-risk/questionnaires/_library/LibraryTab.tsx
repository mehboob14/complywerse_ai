'use client';

// Questionnaires > Library: the questionnaires an organisation can send, as cards or as a list. Kind (Due diligence: the ones suppliers answer in the portal; Tiering: the onboarding questions your
// team answers, edited in Settings), a search over name, category and description, archived ones on request, and the same row menu on a card and in the list. The state is in the address
// (?purpose=, ?view=, ?archived=1, ?q=): every link the old page wrote opens the same list. A failed read says so with Retry; a list cut by the server says by how much.
import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ClipboardList, Copy, DollarSign, Eye, FileCheck, FileText, Lock, Pencil, Plus, Send, Settings, Shield, Star, Trash2, type LucideIcon } from 'lucide-react';
import {
  Button, Checkbox, DebouncedSearch, EmptyState, ErrorState, Menu, Notice, RegisterTable, SectionCard, SegmentedControl, SkeletonRows, StatusPill, useAddressState, type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate } from '@/lib/format';
import { vendorTier } from '@/lib/statuses/vendor';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { builderHref, questionnairesApi } from '../../_lib/questionnairesApi';
import { LIBRARY_SCHEMA, beyond, templateActions, visibleTemplates, type Kind, type TemplateAction, type View } from '../../_lib/questionnaires/hubModel';
import type { Template } from '../../_lib/questionnaires/types';
import { categoryLabel } from '../_forms/categories';
import type { Rights } from '../_forms/useRights';
import { TemplateSettingsSheet } from '../_forms/TemplateSettingsSheet';
import { PreviewSheet } from '../_forms/PreviewSheet';
import { useTemplateOps } from './useTemplateOps';

const CATEGORY_ICON: Record<string, LucideIcon> = { security: Shield, privacy: Lock, compliance: FileCheck, operational: Settings, financial: DollarSign, general: ClipboardList };
const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label text-ds-fg-body';
const MUTED = 'text-ds-fg-muted';

const TieringView = ({ rights }: { rights: Rights }) => {
  const onboarding = useQuery({ queryKey: ['tprm-onboarding-questions'], queryFn: async () => (await questionnairesApi.onboardingQuestions()).data, ...TPRM_QUERY_OPTS });
  const sections = onboarding.data?.sections ?? [];
  const count = sections.reduce((n, s) => n + s.questions.length, 0);
  return (
    <SectionCard
      id="tiering-questions"
      title="Onboarding questions"
      info="Your team answers these about a supplier when it is requested. Each answer adds to a tiering factor, and some can hold the tier at a minimum. They are edited in Settings, where each answer can set a minimum tier."
      meta={onboarding.data ? `${formatCount(count)} questions · ${formatCount(sections.length)} sections` : undefined}
      actions={rights.config ? <Button href="/vendor-risk/settings#questions" variant="primary" leftIcon={<Pencil aria-hidden />}>Edit in Settings</Button> : undefined}
    >
      {onboarding.isError && !onboarding.data
        ? <ErrorState compact title="Couldn't load the onboarding questions" message={errorMessage(onboarding.error)} onRetry={canRetry(onboarding.error) ? () => { void onboarding.refetch(); } : undefined} />
        : !onboarding.data
          ? <SkeletonRows rows={2} columns={2} label="Loading the onboarding questions" />
          : <p className={`text-ds-body ${MUTED}`}>The default tiering questionnaire{rights.config ? '' : '. Changing it needs the right to edit the settings'}.</p>}
    </SectionCard>
  );
};

export function LibraryTab({ templates, total, loading, error, onRetry, rights, onSend, onNew }: {
  templates: Template[];
  total: number | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  rights: Rights;
  onSend: (t: Template) => void;
  onNew: () => void;
}) {
  const uid = useId();
  const router = useRouter();
  const ops = useTemplateOps();
  const [address, setAddress] = useAddressState(LIBRARY_SCHEMA);
  const { purpose, view, archived, q } = address;
  const [settingsFor, setSettingsFor] = useState<Template | null>(null);
  const [previewFor, setPreviewFor] = useState<Template | null>(null);
  const shown = useMemo(() => visibleTemplates(templates, { q, archived }), [templates, q, archived]);
  const cut = beyond(total, templates.length);
  const noList = !!error && templates.length === 0;

  const menuFor = (t: Template) => {
    const items: MenuItem[] = templateActions(t, rights).map((a: TemplateAction): MenuItem => {
      switch (a) {
        case 'edit': case 'open': return { key: a, label: a === 'edit' ? 'Edit' : 'Open', icon: Pencil, onSelect: () => router.push(builderHref(t.id)) };
        case 'send': return { key: a, label: 'Send to a supplier', icon: Send, onSelect: () => onSend(t) };
        case 'preview': return { key: a, label: 'Preview', icon: Eye, onSelect: () => setPreviewFor(t) };
        case 'duplicate': return { key: a, label: 'Duplicate', icon: Copy, onSelect: () => ops.duplicate(t) };
        case 'default_tiers': return { key: a, label: 'Choose default tiers', icon: Star, onSelect: () => setSettingsFor(t) };
        case 'archive': return { key: a, label: 'Archive', icon: Archive, onSelect: () => ops.archive(t) };
        case 'restore': return { key: a, label: 'Restore', icon: ArchiveRestore, onSelect: () => ops.archive(t) };
        default: return { key: a, label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void ops.remove(t); } };
      }
    });
    return <Menu iconOnly label={`Actions for ${t.name.slice(0, 60)}`} items={items} />;
  };

  const chips = (t: Template) => (
    <span className="flex flex-wrap items-center gap-[6px]">
      {t.category && <span className={CHIP}>{categoryLabel(t.category)}</span>}
      {t.default_tiers.map((tier) => <StatusPill key={tier} tone={vendorTier.tone(tier)} label={`${vendorTier.label(tier)} tier`} />)}
      {t.archived_at && <StatusPill tone="warning" label="Archived" />}
    </span>
  );
  const updated = (t: Template) => `Updated ${formatDate(t.updated_at)}${t.updated_by_name ? ` · ${t.updated_by_name}` : ''}`;

  const card = (t: Template) => {
    const Icon = CATEGORY_ICON[(t.category || '').toLowerCase()] ?? FileText;
    const archivedCard = !!t.archived_at;
    return (
      <article key={t.id} className={`flex min-w-0 flex-col gap-[8px] rounded-ds-card border border-ds-border p-[16px] ${archivedCard ? 'bg-ds-surface-subtle' : 'bg-ds-surface'}`}>
        <div className="flex items-start gap-[12px]">
          <span aria-hidden className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-ds-control bg-ds-primary-soft text-ds-primary-text"><Icon className="h-[20px] w-[20px]" strokeWidth={1.75} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="min-w-0 break-words !text-ds-body !font-[600] !text-ds-fg">
              <Link href={builderHref(t.id)} className="rounded-[4px] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{t.name}</Link>
              {t.latest_version ? <span className={`ml-[6px] align-middle text-ds-label font-normal ${MUTED}`} title="Questionnaires already sent keep the version they were sent on">v{t.latest_version}</span> : null}
            </h3>
            <p className={`text-ds-label ${MUTED}`}>{formatCount(t.question_count)} questions · {formatCount(t.section_count)} sections</p>
          </div>
          {menuFor(t)}
        </div>
        <p title={t.description || undefined} className="line-clamp-2 min-h-[40px] text-ds-body text-ds-fg-body">{t.description || ''}</p>
        {chips(t)}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[8px] border-t border-ds-border pt-[12px]">
          {rights.send && !archivedCard && t.question_count > 0
            ? <Button leftIcon={<Send aria-hidden />} onClick={() => onSend(t)}>Send to a supplier</Button>
            : <span />}
          <span className={`text-ds-label ${MUTED}`}>{updated(t)}</span>
        </div>
      </article>
    );
  };

  const columns: RegisterColumn<Template>[] = [
    {
      key: 'name', header: 'Questionnaire', isRowHeader: true,
      cell: (t) => (
        <div className="min-w-0">
          <Link href={builderHref(t.id)} className="line-clamp-2 break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring" title={t.name}>{t.name}</Link>
          {t.description && <span className={`line-clamp-1 text-ds-label ${MUTED}`} title={t.description}>{t.description}</span>}
        </div>
      ),
    },
    { key: 'category', header: 'Category', priority: 2, card: 'meta', cell: (t) => (t.category ? <span className={CHIP}>{categoryLabel(t.category)}</span> : <span className={MUTED}>—</span>) },
    { key: 'questions', header: 'Questions', priority: 2, card: 'meta', cell: (t) => <span className="tabular-nums text-ds-body text-ds-fg-body">{formatCount(t.question_count)} in {formatCount(t.section_count)} sections</span> },
    {
      key: 'tiers', header: 'Default tiers', priority: 3, card: 'meta',
      cell: (t) => (t.default_tiers.length ? <span className="flex flex-wrap gap-[4px]">{t.default_tiers.map((tier) => <StatusPill key={tier} size="sm" tone={vendorTier.tone(tier)} label={`${vendorTier.label(tier)} tier`} />)}</span> : <span className={MUTED}>—</span>),
    },
    { key: 'updated', header: 'Updated', priority: 2, card: 'meta', cell: (t) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(t.updated_at)}</span> },
    { key: 'state', header: 'Status', card: 'meta', cell: (t) => (t.archived_at ? <StatusPill size="sm" tone="warning" label="Archived" /> : <span className={`text-ds-body ${MUTED}`}>{t.used ? 'Sent' : 'Not sent yet'}</span>) },
    { key: 'actions', header: 'Actions', card: 'hide', align: 'right', width: 'w-[56px]', cell: (t) => menuFor(t) },
  ];

  const kindOptions: Array<{ value: Kind; label: string }> = [{ value: 'due_diligence', label: 'Due diligence' }, { value: 'tiering', label: 'Tiering' }];
  const viewOptions: Array<{ value: View; label: string }> = [{ value: 'cards', label: 'Cards' }, { value: 'list', label: 'List' }];

  const body = (() => {
    if (noList) return <ErrorState title="Couldn't load the questionnaires" message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} />;
    if (loading && templates.length === 0) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={6} columns={4} label="Loading the questionnaires" /></div>;
    if (templates.length === 0) {
      return (
        <EmptyState
          kind="firstUse" icon={ClipboardList} title="No questionnaires yet"
          description="Start one from the library or build it question by question. Suppliers answer it in the portal; the answers set the residual score and raise findings."
          action={rights.create ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onNew}>New questionnaire</Button> : undefined}
        />
      );
    }
    if (shown.length === 0) {
      return <EmptyState kind="noMatches" title="No questionnaires match" description="Try another search, or show the archived ones." onClearFilters={q || archived ? () => setAddress({ q: '', archived: false }) : undefined} />;
    }
    if (view === 'list') {
      return (
        <RegisterTable
          caption="Questionnaires" columns={columns} rows={shown} getRowId={(t) => t.id}
          onRowActivate={(t) => router.push(builderHref(t.id))}
          cardTitle={(t) => <span className="flex flex-wrap items-center gap-[6px] font-[600] text-ds-fg">{t.name}</span>}
          cardActions={menuFor}
        />
      );
    }
    return <div className="grid gap-[16px] sm:grid-cols-2 xl:grid-cols-3">{shown.map(card)}</div>;
  })();

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        <SegmentedControl label="Kind of questionnaire" name={`${uid}-kind`} options={kindOptions} value={purpose} onChange={(v) => setAddress({ purpose: v })} />
        {purpose === 'due_diligence' && (
          <>
            <DebouncedSearch className="w-full sm:w-[280px]" label="Search questionnaires" placeholder="Search name, category or description" value={q} onSearch={(next) => setAddress({ q: next })} />
            <Checkbox label="Show archived" checked={archived} onChange={(e) => setAddress({ archived: e.target.checked })} />
            <SegmentedControl label="How to show the questionnaires" name={`${uid}-view`} options={viewOptions} value={view} onChange={(v) => setAddress({ view: v })} className="sm:ml-auto" />
          </>
        )}
      </div>
      {purpose === 'tiering' ? <TieringView rights={rights} /> : (
        <>
          {cut > 0 && <Notice tone="warning" title={`Showing the newest ${formatCount(templates.length)} of ${formatCount(total)} questionnaires`}>The list is cut here. Search, or archive the ones you no longer use, to reach the rest.</Notice>}
          {error != null && !noList && <ErrorState compact title="Couldn't refresh the questionnaires" message={`${errorMessage(error)} What is shown may be out of date.`} onRetry={canRetry(error) ? onRetry : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
          {body}
        </>
      )}
      {settingsFor && <TemplateSettingsSheet open template={settingsFor} canConfig={rights.config} onClose={() => setSettingsFor(null)} onSaved={() => undefined} />}
      <PreviewSheet open={!!previewFor} name={previewFor?.name ?? ''} questions={previewFor?.questions ?? []} onClose={() => setPreviewFor(null)} />
      {ops.confirmDialog}
    </div>
  );
}
