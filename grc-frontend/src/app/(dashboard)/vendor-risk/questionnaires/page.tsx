'use client';

// Questionnaires: the ones asked about a supplier to set its tier (the onboarding questions, kept in Settings) and the ones the
// supplier answers (due diligence), each opening in its own builder. Archived ones are hidden until asked for.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, ClipboardList, Copy, DollarSign, Eye, FileCheck, FileText, Lock, Pencil, Plus, Send, Settings, Shield, Star,
  Trash2, type LucideIcon,
} from 'lucide-react';
import { SearchInput } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { RowActionsMenu, type RowAction } from '@/app/(dashboard)/governance/documents/_workspace/RowActionsMenu';
import {
  Dialog, EmptyState, ErrorState, SegmentedControl, Skeleton, StatusPill, TierBadge, useUrlParams, fmt, BTN, BTN_DANGER, BTN_PRIMARY,
} from '@/app/(dashboard)/vendor-risk/_ui';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { builderHref, questionnairesApi, templatesKey } from '../_lib/questionnairesApi';
import type { Template } from '../_lib/questionnaires/types';
import { NewQuestionnaireDialog, type Purpose } from './_parts/NewQuestionnaireDialog';
import { PreviewDialog } from './_parts/PreviewDialog';
import { SendDialog } from './_parts/SendDialog';
import { SentQuestionnaires } from './_parts/SentQuestionnaires';
import { SettingsDialog } from './_parts/SettingsDialog';
import { categoryLabel } from './_parts/categories';
import { Check, Chip } from './_parts/ui';

const EXPLAINER: Record<Purpose, string> = {
  tiering: 'Your team answers these about a supplier. The answers set its tier.',
  due_diligence: 'Suppliers answer these in the portal. The answers set the residual score and raise findings.',
};

const CATEGORY_ICON: Record<string, LucideIcon> = {
  security: Shield, privacy: Lock, compliance: FileCheck, operational: Settings, financial: DollarSign, general: ClipboardList,
};

/** The rights the server checks (routers/questionnaires.py), each with its erm:risks:edit fallback. */
function useRights() {
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');
  return {
    create: hasPermission('vendor_risk:templates:create') || erm,
    edit: hasPermission('vendor_risk:templates:edit') || erm,
    remove: hasPermission('vendor_risk:templates:delete') || erm,
    send: hasPermission('vendor_risk:assessments:create') || erm,
    config: hasPermission('vendor_risk:config:edit') || erm,
  };
}

function Card({ icon: Icon, title, href, version, meta, description, chips, footer, menu, muted }: {
  icon: LucideIcon; title: string; href: string; version?: number | null; meta: string; description?: string | null;
  chips?: React.ReactNode; footer?: React.ReactNode; menu?: React.ReactNode; muted?: boolean;
}) {
  return (
    // an archived card is subdued with lighter fills and a quieter title, not with CSS opacity: 70% opacity takes the words below 4.5:1
    <article className={`flex flex-col rounded-xl border p-4 ${muted ? 'border-[#e1e6eb] bg-[#f7f9fa]' : 'border-[#d5dbe1] bg-[#fff]'}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${muted ? 'bg-[#eef1f4] text-[#64707e]' : 'bg-[#e6f6f3] text-[#0f766e]'}`}><Icon className="h-5 w-5" strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <h3 className={`truncate text-[15px] font-semibold leading-5 ${muted ? 'text-[#4a5563]' : 'text-[#1f2933]'}`}>
            <Link href={href} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">{title}</Link>
            {version ? <span className="ml-1.5 align-middle text-[11px] font-medium text-[#64707e]" title="Questionnaires already sent keep the version they were sent on">v{version}</span> : null}
          </h3>
          <p className="text-[13px] leading-5 text-[#586472]">{meta}</p>
        </div>
        {menu}
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-[#586472]">{description || ''}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>
      {footer && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#eef1f4] pt-3">{footer}</div>}
    </article>
  );
}

export default function QuestionnairesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const rights = useRights();
  const url = useUrlParams();
  const purpose: Purpose = url.get('purpose') === 'tiering' ? 'tiering' : 'due_diligence';
  const showArchived = url.get('archived') === '1';
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState<Template | null>(null);
  const [tiers, setTiers] = useState<Template | null>(null);
  const [sending, setSending] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);

  const list = useQuery({
    queryKey: [...templatesKey, 'all'],
    queryFn: async () => (await questionnairesApi.list(true)).data.items,
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });
  const onboarding = useQuery({
    queryKey: ['tprm-onboarding-questions'],
    queryFn: async () => (await questionnairesApi.onboardingQuestions()).data,
    ...TPRM_QUERY_OPTS,
  });
  const templates = useMemo(() => list.data ?? [], [list.data]);
  const live = templates.filter((t) => !t.archived_at);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return templates.filter((t) => (showArchived || !t.archived_at)
      && (!term || t.name.toLowerCase().includes(term) || (t.category || '').toLowerCase().includes(term)));
  }, [templates, showArchived, search]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: templatesKey });
  const failed = (title: string) => (e: unknown) => toast({ type: 'error', title, message: apiErrorText(e, 'Try again.') });
  const archive = useMutation({
    mutationFn: async (t: Template) => (await (t.archived_at ? questionnairesApi.restore(t.id) : questionnairesApi.archive(t.id))).data,
    onSuccess: (t) => { refresh(); toast({ type: 'success', title: t.archived_at ? 'Archived' : 'Restored' }); },
    onError: failed('Could not do that'),
  });
  const duplicate = useMutation({
    mutationFn: async (t: Template) => (await questionnairesApi.duplicate(t.id)).data,
    onSuccess: (copy) => { refresh(); toast({ type: 'success', title: 'Questionnaire copied' }); router.push(builderHref(copy.id)); },
    onError: failed('Could not copy it'),
  });
  const remove = useMutation({
    mutationFn: async (t: Template) => { await questionnairesApi.remove(t.id); },
    onSuccess: () => { refresh(); setDeleting(null); toast({ type: 'success', title: 'Questionnaire deleted' }); },
    onError: failed('Could not delete it'),
  });

  const setPurpose = (next: Purpose) => url.set({ purpose: next === 'due_diligence' ? null : next });
  const questionCount = (onboarding.data?.sections ?? []).reduce((n, s) => n + s.questions.length, 0);

  const actions = (t: Template): RowAction[] => [
    { key: 'edit', label: rights.edit && !t.archived_at ? 'Edit' : 'Open', icon: Pencil, onClick: () => router.push(builderHref(t.id)) },
    { key: 'preview', label: 'Preview', icon: Eye, onClick: () => setPreviewing(t), hidden: t.question_count === 0 },
    { key: 'copy', label: 'Duplicate', icon: Copy, onClick: () => duplicate.mutate(t), hidden: !rights.create },
    { key: 'default', label: 'Make default…', icon: Star, onClick: () => setTiers(t), hidden: !rights.edit || !!t.archived_at },
    { key: 'archive', label: t.archived_at ? 'Restore' : 'Archive', icon: t.archived_at ? ArchiveRestore : Archive, onClick: () => archive.mutate(t), hidden: !rights.edit },
    { key: 'delete', label: 'Delete', icon: Trash2, variant: 'danger', onClick: () => setDeleting(t), hidden: !rights.remove || t.used },
  ];

  return (
    <div className="space-y-4">
      <h2 className="sr-only">Questionnaires</h2>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <SegmentedControl<Purpose>
            ariaLabel="Kind of questionnaire"
            value={purpose}
            onChange={setPurpose}
            options={[{ value: 'tiering', label: 'Tiering', count: 1 }, { value: 'due_diligence', label: 'Due diligence', count: live.length }]}
          />
          <p className="max-w-xl text-[13px] leading-5 text-[#586472]">{EXPLAINER[purpose]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {purpose === 'due_diligence' && (
            <>
              <div className="w-56"><SearchInput value={search} onChange={setSearch} placeholder="Search questionnaires" size="sm" aria-label="Search questionnaires" /></div>
              <Check checked={showArchived} onChange={(on) => url.set({ archived: on ? '1' : null })}>Show archived</Check>
            </>
          )}
          {rights.create && (
            <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}><Plus aria-hidden className="h-4 w-4" /> New questionnaire</button>
          )}
        </div>
      </div>

      {purpose === 'tiering' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card
            icon={ClipboardList}
            title="Onboarding questions"
            href="/vendor-risk/settings#questions"
            meta={onboarding.data ? `${questionCount} questions · ${onboarding.data.sections.length} sections` : 'Loading…'}
            description="Asked of whoever requests a supplier. Each answer adds to a tiering factor, and some can hold the tier at a minimum."
            chips={<span className="inline-flex items-center gap-1 rounded bg-[#e6f6f3] px-1.5 py-0.5 text-[12px] font-medium leading-4 text-[#0f766e]"><Star aria-hidden className="h-3 w-3" /> Default</span>}
            footer={<Link href="/vendor-risk/settings#questions" className={BTN}><Pencil aria-hidden className="h-4 w-4" /> Edit in Settings</Link>}
          />
        </div>
      ) : list.isError && !list.data ? (
        <ErrorState title="Couldn't load the questionnaires" message={apiErrorText(list.error, 'Try again.')} onRetry={() => list.refetch()} />
      ) : list.isLoading && !list.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState
          title="No questionnaires here yet"
          hint={search ? 'Nothing matches the search.' : 'Start one from the library or build it question by question.'}
          action={rights.create && !search ? <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}><Plus aria-hidden className="h-4 w-4" /> New questionnaire</button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <Card
              key={t.id}
              muted={!!t.archived_at}
              icon={CATEGORY_ICON[(t.category || '').toLowerCase()] ?? FileText}
              title={t.name}
              href={builderHref(t.id)}
              version={t.latest_version}
              meta={`${t.question_count} questions · ${t.section_count} sections`}
              description={t.description}
              menu={<RowActionsMenu actions={actions(t)} />}
              chips={(
                <>
                  {t.category && <Chip>{categoryLabel(t.category)}</Chip>}
                  {t.default_tiers.map((tier) => <TierBadge key={tier} tier={tier} suffix="tier" />)}
                  {t.archived_at && <StatusPill tone="warning">Archived</StatusPill>}
                </>
              )}
              footer={(
                <>
                  {rights.send && !t.archived_at && t.question_count > 0
                    ? <button type="button" onClick={() => setSending(t)} className={BTN}><Send aria-hidden className="h-4 w-4" /> Send to a vendor</button>
                    : <span />}
                  <span className="text-[12px] leading-4 text-[#64707e]">Updated {fmt.date(t.updated_at)}{t.updated_by_name ? ` · ${t.updated_by_name}` : ''}</span>
                </>
              )}
            />
          ))}
        </div>
      )}

      {purpose === 'due_diligence' && <SentQuestionnaires templates={templates} />}

      <NewQuestionnaireDialog open={creating} purpose={purpose} templates={templates} onClose={() => setCreating(false)} />
      <PreviewDialog open={!!previewing} name={previewing?.name ?? ''} questions={previewing?.questions ?? []} onClose={() => setPreviewing(null)} />
      {tiers && (
        <SettingsDialog open template={tiers} canConfig={rights.config} onClose={() => setTiers(null)} onSaved={() => refresh()} />
      )}
      <SendDialog templateId={sending?.id ?? null} templateName={sending?.name ?? ''} onClose={() => setSending(null)} />
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this questionnaire?"
        description={deleting ? `“${deleting.name}” has never been sent, so nothing is recorded against it.` : undefined}
        footer={(
          <>
            <button type="button" onClick={() => setDeleting(null)} className={BTN}>Cancel</button>
            <button type="button" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)} className={BTN_DANGER}>
              {remove.isPending ? 'Deleting…' : 'Delete questionnaire'}
            </button>
          </>
        )}
      >
        <p className="text-sm leading-5 text-[#26323d]">This cannot be undone.</p>
      </Dialog>
    </div>
  );
}
