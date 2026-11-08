'use client';

/**
 * The organisation profile: what every framework's onboarding reads, asked once, in four stages (entities and sites, regulators and obligations, data and
 * systems, risk and people). One stage is open at a time (in the address, `?stage=`). Every change is saved as it is made: a short pause after the last key
 * stroke sends what changed. When the server refuses a value, its message shows under that field and that value is not sent again until it is changed (the
 * other fields go on saving); when a save fails for any other reason, saving stops and says so until the person tries again or changes something. What is
 * pending is sent as the page is left. A save the server answers with "not allowed" turns the page into a view-only one. The rules are profileModel.ts.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight } from 'lucide-react';
import { PageHeading } from '@/components/ui/ds/PageHeading';
import { Button, ErrorState, Notice, ReadOnlyNote, SectionCard, SkeletonLines, StatusPill, useNotify } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useAddressState } from '@/components/ui/ds/useAddressState';
import { text } from '@/lib/addressState';
import { onboardingApi, ONBOARDING_KEYS, problemOf, type Refs } from '@/lib/frameworkOnboarding';
import FieldBlock from '../FieldBlock';
import SourceChip from '../SourceChip';
import ProfileStages, { panelId, tabId } from './ProfileStages';
import StillNeeded from './StillNeeded';
import {
  afterSave, batchToSend, fieldMap, isWide, keyOf, mergeRefs, mirrorsOrganisation, nextStage, openingStage, refusalOf, SAVE_WORDS, saveState, stageProgress,
  stillNeeded, valueAt, visibleFields, type Needed,
} from './profileModel';

const SHELL = 'mx-auto flex max-w-7xl flex-col gap-[16px]';
const ADDRESS = { stage: text() };
const NO_REFS: Refs = { users: {}, assets: {}, vendors: {}, departments: {} };
const SAVE_AFTER_MS = 800;
const OTHER_SCREENS = ['fw-onboarding-register', 'fw-onboarding', 'fw-onboarding-gate'];

const without = <T,>(map: Record<string, T>, keys: string[]): Record<string, T> => Object.fromEntries(Object.entries(map).filter(([k]) => !keys.includes(k)));

export default function OrganisationProfile() {
  const qc = useQueryClient();
  const notify = useNotify();
  const tabsBase = useId();
  const [address, setAddress] = useAddressState(ADDRESS);
  const catalog = useQuery({ queryKey: ['org-profile-catalog'], queryFn: onboardingApi.profileCatalog, staleTime: 10 * 60_000 });
  const profile = useQuery({ queryKey: [...ONBOARDING_KEYS.profile], queryFn: onboardingApi.profile });

  const [draft, setDraft] = useState<Record<string, unknown>>({});                    // what was typed, by "group.field": shown over the server's value
  const [pending, setPending] = useState<Record<string, unknown>>({});                // typed and not yet accepted by the server
  const [refused, setRefused] = useState<Record<string, string>>({});                 // the values the server refused (as text), not sent again until they change
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [halt, setHalt] = useState<{ message: string; batch: string; refusal: boolean } | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [extraRefs, setExtraRefs] = useState<Refs>(NO_REFS);
  const [jump, setJump] = useState<string | null>(null);
  const opened = useRef<string | null>(null);

  const view = profile.data;
  const groups = useMemo(() => catalog.data?.groups ?? [], [catalog.data]);
  const known = useMemo(() => fieldMap(groups), [groups]);

  const batch = useMemo(() => batchToSend(pending, refused), [pending, refused]);
  const batchText = JSON.stringify(batch);
  const toSend = Object.keys(batch).length;
  const dirty = Object.keys(pending).length > 0 && !viewOnly;

  const save = useMutation({
    mutationFn: (sending: Record<string, unknown>) => onboardingApi.saveProfile(sending),
    onSuccess: (next, sent) => {
      qc.setQueryData([...ONBOARDING_KEYS.profile], next);
      const keys = Object.keys(sent);
      setPending((p) => afterSave(p, sent));
      setErrors((e) => without(e, keys));
      setRefused((r) => without(r, keys));
      setHalt(null);
      setSavedOnce(true);
      for (const key of OTHER_SCREENS) void qc.invalidateQueries({ queryKey: [key] });      // the register and the workspaces read the profile
    },
    onError: (e, sent) => {
      const problem = problemOf(e);
      if (problem.status === 403) { setViewOnly(true); setPending({}); setDraft({}); setErrors({}); setRefused({}); setHalt(null); return; }
      const { byField, general } = refusalOf(problem, known);
      const fields = Object.keys(byField);
      if (fields.length > 0) {
        setErrors((cur) => ({ ...cur, ...byField }));
        setRefused((cur) => ({ ...cur, ...Object.fromEntries(fields.map((k) => [k, JSON.stringify(sent[k] ?? null)])) }));
      } else {
        setHalt({ message: general ?? problem.message, batch: JSON.stringify(sent), refusal: problem.status === 409 });
      }
    },
  });

  // a short pause after the last change sends what changed; a refused or failed batch waits until something in it changes
  useEffect(() => {
    if (viewOnly || save.isPending || toSend === 0) return undefined;
    if (halt && halt.batch === batchText) return undefined;
    const t = setTimeout(() => save.mutate(batch), SAVE_AFTER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- batchText stands for batch
  }, [batchText, save.isPending, viewOnly, halt]);

  // leaving the page with something typed in the last moment: it is sent as the page goes
  const leaving = useRef({ pending, refused, viewOnly });
  leaving.current = { pending, refused, viewOnly };
  useEffect(() => () => {
    const { pending: left, refused: no, viewOnly: locked } = leaving.current;
    const rest = batchToSend(left, no);
    if (locked || Object.keys(rest).length === 0) return;
    onboardingApi.saveProfile(rest).then(() => { for (const key of OTHER_SCREENS) void qc.invalidateQueries({ queryKey: [key] }); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // closing the tab with changes the server has not taken: the browser asks first
  useEffect(() => {
    if (!dirty) return undefined;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);

  const review = useMutation({
    mutationFn: (group: string) => onboardingApi.reviewGroup(group),
    onSuccess: (next) => {
      qc.setQueryData([...ONBOARDING_KEYS.profile], next);
      for (const key of OTHER_SCREENS) void qc.invalidateQueries({ queryKey: [key] });
      notify.success('Stage marked as reviewed');
    },
    onError: (e) => {
      if (problemOf(e).status === 403) setViewOnly(true);
      else notify.error(e, { title: "Couldn't mark the stage as reviewed" });
    },
  });

  const change = useCallback((key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setPending((p) => ({ ...p, [key]: value }));
    setErrors((e) => (key in e ? without(e, [key]) : e));
    setRefused((r) => (key in r ? without(r, [key]) : r));                          // a touched field may be tried again
  }, []);
  const tryAgain = () => { setHalt(null); setRefused({}); setErrors({}); if (Object.keys(pending).length > 0) save.mutate(pending); };
  const undo = () => {
    const keys = Object.keys(pending);
    setDraft((d) => without(d, keys)); setPending({}); setRefused({}); setErrors({}); setHalt(null);
  };

  // opening a stage from the list of what is still needed: the field is brought into view once its stage is on the screen
  useEffect(() => {
    if (!jump) return;
    const el = document.querySelector<HTMLElement>(`[data-field="${jump}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
    }
    setJump(null);
  }, [jump, address.stage]);

  if (catalog.isLoading || profile.isLoading) return <div className={SHELL}><SkeletonLines lines={8} label="Loading the organisation profile" /></div>;
  const failure = catalog.error ?? profile.error;
  if (failure || !view || groups.length === 0) {
    return (
      <div className={SHELL}>
        <ErrorState title="Couldn't open the organisation profile" message={errorMessage(failure)} onRetry={!failure || canRetry(failure) ? () => { void catalog.refetch(); void profile.refetch(); } : undefined} />
      </div>
    );
  }

  if (opened.current === null) opened.current = openingStage(groups, address.stage, view.evaluation);
  const stage = groups.some((g) => g.key === address.stage) ? address.stage : opened.current;
  const group = groups.find((g) => g.key === stage) ?? groups[0];
  const refs = mergeRefs(view.refs, extraRefs);
  const locked = viewOnly;
  const progress = stageProgress(view.evaluation.groups[group.key]);
  const fields = visibleFields(group, groups, view.values, draft);
  const needed = stillNeeded(groups, view.evaluation, catalog.data?.checks ?? [], view.values, draft);
  const next = nextStage(groups, group.key);
  const state = saveState({ pending: toSend > 0, saving: save.isPending, failed: halt !== null || Object.keys(errors).length > 0, saved: savedOnce });
  const pick = (key: string) => setAddress({ stage: key }, { push: true });
  const goTo = (item: Needed) => { pick(item.stage); setJump(item.field); };

  return (
    <div className={SHELL}>
      <PageHeading
        title="Organisation Profile"
        info="Asked once and reused by every framework's onboarding. A framework asks only for what is specific to it and picks sites, systems, third parties and data types from here."
        meta={state !== 'idle' ? <span role="status" aria-live="polite">{SAVE_WORDS[state]}</span> : undefined}
        actions={(
          <>
            {locked && <ReadOnlyNote>View only <InfoTip label="Why this page is view only" text="Your last change was not saved. Only people who can edit frameworks can change the organisation profile." /></ReadOnlyNote>}
            <Button href="/frameworks/onboarding" rightIcon={<ChevronRight aria-hidden />}>Framework onboarding</Button>
          </>
        )}
      />
      {halt && (
        <Notice
          tone="danger" title="Couldn't save the last change"
          action={<span className="flex flex-wrap gap-[8px]"><Button size="sm" loading={save.isPending} onClick={tryAgain}>Try again</Button>{halt.refusal && <Button size="sm" onClick={undo}>Undo my change</Button>}</span>}
        >{halt.message}</Notice>
      )}
      {!halt && Object.keys(errors).length > 0 && (
        <Notice tone="danger" title="Some answers were not saved" action={<Button size="sm" loading={save.isPending} onClick={tryAgain}>Try again</Button>}>Correct the fields marked below. The rest keeps saving.</Notice>
      )}
      <ProfileStages base={tabsBase} groups={groups} states={view.evaluation.groups} current={group.key} onPick={pick} />
      <div className="grid min-w-0 gap-[16px] xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div role="tabpanel" id={panelId(tabsBase, group.key)} aria-labelledby={tabId(tabsBase, group.key)} tabIndex={0} className="min-w-0 focus-visible:outline-none focus-visible:shadow-ds-ring">
          <SectionCard id={`stage-${group.key}`} title={group.label} meta={progress.text ? `${progress.text} required` : undefined}>
            {group.source && <div className="mb-[12px]"><SourceChip source={group.source} /></div>}
            <div className="grid min-w-0 gap-x-[16px] gap-y-[20px] md:grid-cols-2">
              {fields.map((f) => {
                const key = keyOf(group.key, f.key);
                return (
                  <div key={key} className={isWide(f) ? 'min-w-0 md:col-span-2' : 'min-w-0'}>
                    <FieldBlock
                      field={f} source={f.source ?? null} value={key in draft ? draft[key] : valueAt(view.values, {}, key)} onChange={(v) => change(key, v)}
                      error={errors[key] ?? null} readOnly={locked} refs={refs} onRefs={(patch) => setExtraRefs((cur) => mergeRefs(cur, patch))} departments={view.departments}
                    />
                    {mirrorsOrganisation(f) && <p className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">Same value as in Administration &gt; Organization.</p>}
                  </div>
                );
              })}
            </div>
            <div className="mt-[20px] flex flex-wrap items-center gap-[8px] border-t border-ds-border pt-[12px]">
              {!locked && (progress.reviewed
                ? <StatusPill tone="success" label="Reviewed" />
                : <Button leftIcon={<Check aria-hidden />} loading={review.isPending} disabled={!progress.complete || dirty} onClick={() => review.mutate(group.key)}>Mark stage reviewed</Button>)}
              {!locked && !progress.reviewed && !progress.complete && <span className="text-ds-label text-ds-fg-muted">Fill the required fields first.</span>}
              {next && <Button className="ml-auto" rightIcon={<ChevronRight aria-hidden />} onClick={() => pick(next)}>Next stage</Button>}
            </div>
          </SectionCard>
        </div>
        <aside className="min-w-0"><StillNeeded groups={groups} required={needed.required} advice={needed.advice} onJump={goTo} /></aside>
      </div>
    </div>
  );
}
