'use client';

// Setup > Settings: the module's configuration as a section nav (Tiering, Reviews and reminders, Monitoring, Supplier records, Questionnaire scoring, Exposure model, Emails). The section is in the
// address (?section=), so a link opens it. Each section holds its own edits, shows a dot when they are not saved and saves on its own: only the keys of the open section are sent (settingsModel.bodyOf).
// Edits are held in this page, not in the section that draws them, so moving to another section keeps them; a refetch never overwrites them (the old page re-seeded its draft from the server on every
// refetch). Leaving the page with edits asks first, for a link or the browser. The old addresses (#questions, #exposure, /settings/emails ...) land on the right place (settingsModel.legacyTarget).
// Tiering, Reviews and reminders, Monitoring and the exposure model edit the program config (GET and PUT /vendor-risk/tpra/config); records and emails save with their own buttons.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { ErrorState, FormField, ReadOnlyNote, SaveBar, SectionCard, Select, SkeletonRows, useConfirm, useAddressState, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { oneOf } from '@/lib/addressState';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { tpraApi } from '@/lib/api';
import { VendorTabs } from '../_lib/VendorNav';
import { useLeaveGuard } from '../_lib/useLeaveGuard';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { questionsProblems } from './_Questions';
import { exposureSummary } from './_Exposure';
import ExposureSection from './_Exposure';
import type { Directory } from './_ui';
import EmailsSection from './_sections/Emails';
import MonitoringSection from './_sections/Monitoring';
import RecordsSection from './_sections/Records';
import RemindersSection from './_sections/Reminders';
import ScoringSection from './_sections/Scoring';
import TieringSection, { TIERING_PARTS } from './_sections/Tiering';
import { DefaultsButton, type SettingsCtx } from './_sections/shared';
import {
  SECTIONS, SECTION_IDS, bodyOf, dirtyKeys, dirtyOf, problemsOf, sectionOf, sectionOfAnchor, toDraft, type ConfigResp, type Draft, type DraftKey, type SectionId,
} from './settingsModel';

const SCHEMA = { section: oneOf(SECTION_IDS, 'tiering') };
const CONFIG_KEY = ['tprm-config'] as const;
const INFO = 'Each section keeps its own changes and saves on its own. Where each tier starts, how often it is reviewed, who reviews and approves it and what an alert sets off are on the Policy page.';

const NAV_ITEM = 'flex min-h-ds-control w-full items-center justify-between gap-[8px] rounded-ds-control px-[12px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring';

export default function VendorRiskSettingsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const uid = useId();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:config:edit') || hasPermission('erm:risks:edit');           // the server accepts either (rbac.require_write falls back to the risk-edit right)
  const label = routeFor('/vendor-risk/settings')?.label ?? 'Third-party risk settings';
  const [{ section }, setAddress] = useAddressState(SCHEMA);
  const current = sectionOf(section);

  const config = useQuery({ queryKey: CONFIG_KEY, queryFn: async () => (await tpraApi.getConfig()).data as ConfigResp, ...TPRM_QUERY_OPTS });
  const directory = useQuery({ queryKey: ['tprm-config-directory'], queryFn: async () => (await tpraApi.configDirectory()).data as Directory, ...TPRM_QUERY_OPTS });
  const data = config.data;
  const saved = useMemo(() => (data ? toDraft(data, data) : null), [data]);
  const defaults = useMemo(() => (data ? toDraft(data, data.defaults) : null), [data]);
  // What the person changed, by key. The form shows the saved value until a key is changed; a refetch changes `saved` and never `edited`.
  const [edited, setEdited] = useState<Partial<Draft>>({});
  const draft = useMemo(() => (saved ? ({ ...saved, ...edited } as Draft) : null), [saved, edited]);
  const dirty = useMemo(() => (draft && saved ? dirtyKeys(draft, saved) : []), [draft, saved]);
  const [emailsDirty, setEmailsDirty] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [openParts, setOpenParts] = useState<ReadonlySet<string>>(new Set<string>(['questions']));
  const wanted = useRef<string | null>(null);              // the anchor a link asked for, scrolled to once its section is drawn

  // an old address (#questions, #exposure ...) opens its section, and its part; one that moved to the Policy page goes there
  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    if (!hash) return;
    const id = hash.slice(1);
    const to = hash.startsWith('#') ? sectionOfAnchor(hash) : null;
    if (to) {
      wanted.current = id;
      setAddress({ section: to });
      if ((TIERING_PARTS as readonly string[]).includes(id)) setOpenParts(new Set([id]));
    } else if (id === 'thresholds' || id === 'cadence' || id === 'alert-rules') {
      router.replace(id === 'alert-rules' ? '/vendor-risk/policy#alert-rules' : '/vendor-risk/policy#bands');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!wanted.current || !draft) return undefined;
    const t = window.setTimeout(() => {
      document.getElementById(wanted.current as string)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      wanted.current = null;
    }, 120);
    return () => window.clearTimeout(t);
  }, [draft, section]);
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = window.setTimeout(() => setSavedAt(null), 4000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  useLeaveGuard(dirty.length > 0 || emailsDirty, () => confirm({ title: 'Leave without saving?', message: 'Some changes on this page have not been saved.', confirmLabel: 'Leave', cancelLabel: 'Stay', tone: 'danger' }));

  const set = useCallback(<K extends DraftKey>(key: K, value: Draft[K]) => { setEdited((e) => ({ ...e, [key]: value })); setServerError(null); setSavedAt(null); }, []);
  const setMany = useCallback((patch: Partial<Draft>) => { setEdited((e) => ({ ...e, ...patch })); setServerError(null); setSavedAt(null); }, []);

  const own = dirtyOf(current, dirty);
  const save = useReportedMutation({
    mutationFn: (keys: DraftKey[]) => tpraApi.saveConfig(bodyOf(keys, draft as Draft) as Parameters<typeof tpraApi.saveConfig>[0]),
    success: () => ({ title: `${current.label} saved`, message: 'The new values are used from now on.' }),
    failure: `${current.label} could not be saved.`,
    toast: 'success',                                                      // a refusal is said on the save bar, in the server's words
    onSuccess: async (_r, keys) => {
      await Promise.all(['tprm-config', 'tprm-quant-history', 'tprm-exposure'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      setEdited((e) => { const next = { ...e }; keys.forEach((k) => { delete next[k]; }); return next; });
      setServerError(null);
      setSavedAt(Date.now());
    },
    onError: (e) => setServerError(errorMessage(e, `${current.label} could not be saved. Try again.`)),
  });

  const goto = (id: SectionId) => { setAddress({ section: id }); setSavedAt(null); setServerError(null); };
  const sectionDirty = (id: SectionId): boolean => (id === 'emails' ? emailsDirty : dirtyOf(sectionOf(id), dirty).length > 0);

  const ctx: SettingsCtx | null = data && draft && saved && defaults
    ? { data, draft, saved, defaults, canEdit, directory: directory.data, set, setMany, dirty }
    : null;
  const problems = ctx ? problemsOf(own, ctx.draft, current.id === 'tiering' ? questionsProblems(ctx.draft.custom_questions) : []) : [];
  const needsConfig = current.id !== 'records' && current.id !== 'emails';

  const body = (() => {
    if (current.id === 'records') return <RecordsSection canEdit={canEdit} />;      // its editors read their own settings: they open even while the config loads
    if (current.id === 'emails') return <EmailsSection onDirty={setEmailsDirty} />;
    if (config.isLoading) return <SkeletonRows rows={6} columns={2} label={`Loading ${current.label.toLowerCase()}`} />;
    if (config.isError || !ctx) return <ErrorState title="Couldn't load the settings" message={errorMessage(config.error)} onRetry={canRetry(config.error) ? () => { void config.refetch(); } : undefined} />;
    switch (current.id) {
      case 'tiering': return (
        <TieringSection ctx={ctx} open={openParts}
          onOpen={(part, on) => setOpenParts((s) => { const n = new Set(s); if (on) n.add(part); else n.delete(part); return n; })} />
      );
      case 'reminders': return <RemindersSection ctx={ctx} />;
      case 'monitoring': return <MonitoringSection ctx={ctx} />;
      case 'scoring': return <ScoringSection ctx={ctx} />;
      case 'exposure': return (
        <SectionCard id="exposure" title="Exposure model" meta={exposureSummary(ctx.draft.quantification)} actions={<DefaultsButton ctx={ctx} keys={['quantification']} />}>
          <ExposureSection value={ctx.draft.quantification} onChange={(q) => set('quantification', q)} canEdit={canEdit} />
        </SectionCard>
      );
      default: return null;
    }
  })();

  return (
    <div className="flex min-w-0 flex-col gap-[16px] pb-[16px]">
      <PageHeader
        variant="page"
        title={label}
        info={INFO}
        meta={!canEdit ? <ReadOnlyNote>View only <InfoTip text="Only people who may configure Vendor Risk can change these settings." label="Why these settings are view only" /></ReadOnlyNote> : undefined}
      />
      <VendorTabs />
      <div className="grid min-w-0 gap-[16px] lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="lg:hidden">
            <FormField label="Section">
              <Select value={current.id} onChange={(e) => goto(e.target.value as SectionId)}>
                {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}{sectionDirty(s.id) ? ' (unsaved)' : ''}</option>)}
              </Select>
            </FormField>
          </div>
          <nav aria-label="Settings sections" className="sticky top-[12px] hidden flex-col gap-[2px] lg:flex">
            {SECTIONS.map((s) => {
              const here = s.id === current.id;
              const unsaved = sectionDirty(s.id);
              return (
                <button key={s.id} type="button" onClick={() => goto(s.id)} aria-current={here ? 'page' : undefined}
                  className={clsx(NAV_ITEM, here ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : 'text-ds-fg hover:bg-ds-surface-hover')}>
                  <span className="min-w-0 break-words">{s.label}</span>
                  {unsaved && <span className="h-[8px] w-[8px] shrink-0 rounded-full bg-ds-warning" aria-hidden />}
                  {unsaved && <span className="sr-only">Unsaved changes</span>}
                </button>
              );
            })}
          </nav>
        </div>
        <div id={`${uid}-section`} className="flex min-w-0 flex-col gap-[16px]">
          <p className="text-ds-body text-ds-fg-muted">{current.about}</p>
          {body}
          {needsConfig && ctx && (
            <SaveBar
              label={`Save ${current.label.toLowerCase()}`}
              saveLabel={`Save ${current.label.toLowerCase()}`}
              canEdit={canEdit}
              dirty={own.length > 0}
              invalid={problems.length > 0}
              saving={save.isPending}
              justSaved={savedAt !== null && own.length === 0}
              error={serverError ?? (problems.length > 0 && own.length > 0 ? `${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}` : null)}
              onSave={() => save.mutate(own)}
              onDiscard={() => { setEdited((e) => { const next = { ...e }; own.forEach((k) => { delete next[k]; }); return next; }); setServerError(null); }}
            />
          )}
          <p className="text-ds-label text-ds-fg-muted">
            Questionnaire templates are under <Link href="/vendor-risk/questionnaires" className="font-[500] text-ds-primary-text underline">Questionnaires</Link>; connections to rating, discovery and gateway services are under{' '}
            <Link href="/admin/connectors" className="font-[500] text-ds-primary-text underline">Administration, Connectors</Link>.
          </p>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
