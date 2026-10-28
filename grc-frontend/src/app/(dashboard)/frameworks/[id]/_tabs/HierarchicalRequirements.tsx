'use client';

/**
 * The Requirements spine for a framework whose journey carries the standard's own structure (`control_structure`, today UAE IA):
 * numbered sections (families) that open and close, sub-family bands under them (id, name, objective, and the standard's other fields
 * behind an (i)), then the control cards with their priority and applicability, and each card opens to its sub-controls. The rules
 * (grouping, counts, what starts open, lead-ins) are in requirementTree.ts; this file only draws them. The card keeps its click →
 * the page's requirement modal; ticks go through the page's own `toggleCriterion`, so a tick moves the control's status as before.
 * The look is the flat spine's (numbered circles on an emerald trunk, `rounded-xl` cards); geometry that the flat spine takes from
 * `h-12 w-12` (which the platform CSS shrinks to 2.5rem) is written out in px here so the trunk meets the circles and the arms.
 * Below `sm` (a phone) there is no spine: the trunk, legs and arms are `max-sm:hidden`, the circle sits inline with the heading, and
 * nothing is indented, so the text keeps the width. Those are `max-sm:` classes added to the ones above, which stay as they were from `sm` up.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Info } from 'lucide-react';
import type { CertificationControl, ControlStructure } from '@/types';
import ControlDetail, { type PageUser } from './ControlDetail';
import { ApplicabilityChip, FOCUS, PriorityChip } from './RequirementChips';
import {
  buildTree, focusLayer, initialState, isCompliant, isOpen, parseLayer, progress, setAll, statusOf, storageKey, subControlsWithEvidence, toggled,
  totalProgress, treeControls,
  type BandNode, type FamilyNode, type NodeKind, type OpenState, type SectionInput,
} from './requirementTree';

interface Ctx {
  journeyId: number;
  open: (kind: NodeKind, key: string | number) => boolean;
  toggle: (kind: NodeKind, key: string | number) => void;
  criteriaState: Record<number, Record<string, boolean>>;
  onToggleCriterion: (control: CertificationControl, index: number) => void;
  onOpenControl: (control: CertificationControl) => void;
  frameworkLabel: string;
  users: PageUser[];
}

const domId = (prefix: string, key: string | number): string => `req-${prefix}-${String(key).replace(/[^A-Za-z0-9_-]+/g, '-')}`;

const TOOL = `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#d5dbe1] bg-[#fff] px-3 text-xs font-medium text-[#26323d] transition-colors hover:bg-[#f3f6f8] ${FOCUS}`;

/** The standard's other fields for a family or sub-family; a field it does not print is not shown. */
function StandardDetails({ id, fields }: { id: string; fields: { label: string; text?: string | null; items?: string[] | null }[] }) {
  const shown = fields.filter((f) => (f.text && f.text.trim()) || (f.items && f.items.length > 0));
  if (shown.length === 0) return null;
  return (
    <dl id={id} data-testid="req-details" className="mt-2 space-y-2 rounded-xl border border-emerald-100 bg-[#fbfefd] px-3 py-2">
      {shown.map((f) => (
        <div key={f.label}>
          <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">{f.label}</dt>
          <dd className="mt-0.5 break-words text-xs text-slate-700">
            {f.items && f.items.length > 0 ? <ul className="list-disc space-y-0.5 pl-4">{f.items.map((item, i) => <li key={i}>{item}</li>)}</ul> : f.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The (i) beside a family or sub-family: shows the standard's other fields under it. */
function AboutToggle({ open, onClick, label, controls }: { open: boolean; onClick: () => void; label: string; controls: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      onClick={onClick}
      className={`mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full hover:text-[#26323d] ${open ? 'bg-[#e0f4ef] text-[#0f766e]' : 'text-[#7b8794]'} ${FOCUS}`}
    >
      <Info className="h-4 w-4" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function ControlCard({ control, last, ctx }: { control: CertificationControl; last: boolean; ctx: Ctx }) {
  const isOpenNow = ctx.open('c', control.id);
  const panelId = domId('ctl', control.id);
  const { met, total } = progress(control, statusOf(control, ctx.criteriaState));
  const withFiles = subControlsWithEvidence(control);

  const done = isCompliant(control.status);
  const isInProgress = control.status === 'in_progress';
  const isNA = control.status === 'not_applicable';
  const dotClass = done ? 'bg-emerald-600 border-emerald-600' : isInProgress ? 'bg-orange-500 border-orange-500' : isNA ? 'bg-slate-300 border-slate-300' : 'bg-white border-slate-300';
  const statusLabel = done ? 'Compliant' : isInProgress ? 'In progress' : isNA ? 'Not applicable' : 'Not implemented';
  const evidenceTotal = control.required_evidence_count ?? (control.evidence_requirements?.length || 0);
  const evidenceApproved = control.approved_evidence_count ?? (control.evidence?.filter((e) => e.review_status === 'approved').length || 0);

  return (
    <div data-testid="req-control" data-code={control.control_code} data-expanded={isOpenNow ? 'true' : 'false'} className="relative">
      {/* The lighter rail from the sub-family: a leg that carries on to the next card (or stops at the bend) and an arm to this one. */}
      <div aria-hidden className="absolute -left-[14px] -top-2 w-[2px] bg-emerald-300 max-sm:hidden" style={{ height: last ? 'calc(0.5rem + 1.45rem)' : 'calc(100% + 0.5rem)' }} />
      <div aria-hidden className="absolute -left-[14px] top-[1.4rem] h-[2px] w-[14px] bg-emerald-300 max-sm:hidden" />
      <div className="rounded-xl border border-slate-200 bg-white transition-colors hover:border-emerald-300">
        <div className="flex items-stretch">
          <button
            type="button"
            aria-expanded={isOpenNow}
            aria-controls={panelId}
            aria-label={`${isOpenNow ? 'Hide' : 'Show'} details of ${control.control_code}`}
            onClick={() => ctx.toggle('c', control.id)}
            className={`flex w-8 shrink-0 items-center justify-center rounded-l-xl text-slate-500 hover:text-[#26323d] max-sm:w-7 ${FOCUS}`}
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${isOpenNow ? 'rotate-90' : ''}`} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => ctx.onOpenControl(control)}
            className={`group min-w-0 flex-1 rounded-r-xl py-3 pl-1 pr-3 text-left max-sm:pr-2 ${FOCUS}`}
          >
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="flex min-w-0 flex-1 basis-[13rem] items-center gap-3">
                <span className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${dotClass}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="break-all font-mono text-sm font-medium text-primary-700">{control.control_code}</span>
                    <span className="min-w-0 break-words text-sm font-medium text-slate-900">{control.control_name}</span>
                    {control.is_critical && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
                        title={control.criticality_reason || 'AI-flagged critical clause'}
                      >
                        Critical
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs text-slate-500">
                      {statusLabel}
                      {evidenceTotal > 0 && <> · {evidenceApproved}/{evidenceTotal} evidence approved</>}
                      {total > 0 && <> · <span data-testid="req-control-met">{met}/{total}</span> sub-controls met</>}
                      {withFiles > 0 && <> · <span title="Sub-controls with a file of their own" data-testid="req-control-files">{withFiles}</span> with evidence</>}
                    </span>
                    <PriorityChip tier={control.priority_tier} />
                    <ApplicabilityChip text={control.applicability} />
                  </span>
                </span>
              </span>
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 group-hover:border-emerald-400 group-hover:text-emerald-700">
                {done || isNA ? 'View' : 'Continue →'}
              </span>
            </span>
          </button>
        </div>
        {isOpenNow && (
          <ControlDetail
            control={control}
            id={panelId}
            journeyId={ctx.journeyId}
            criteriaState={ctx.criteriaState}
            onToggleCriterion={ctx.onToggleCriterion}
            frameworkLabel={ctx.frameworkLabel}
            users={ctx.users}
          />
        )}
      </div>
    </div>
  );
}

function BandSection({ band, last, ctx }: { band: BandNode; last: boolean; ctx: Ctx }) {
  const isOpenNow = ctx.open('b', band.key);
  const [about, setAbout] = useState(false);
  const info = band.info;
  const panelId = domId('band', band.key);
  const aboutId = domId('band-about', band.key);
  const fields = [
    { label: 'Objective', text: info?.objective },
    { label: 'Performance indicators', items: info?.performance_indicators },
    { label: 'Automation guidance', text: info?.automation_guidance },
    { label: 'Relevant threats and vulnerabilities', items: info?.threats },
  ];
  const hasMore = fields.some((f) => (f.text && f.text.trim()) || (f.items && f.items.length > 0));

  return (
    <div data-testid="req-subfamily" data-subfamily={band.id} className="relative">
      {/* The trunk's branch to this band, as the flat spine draws one to each card. */}
      <div aria-hidden className="absolute -left-[45.5px] top-0 w-[3px] rounded-full bg-emerald-600/80 max-sm:hidden" style={{ height: last ? '1.2rem' : 'calc(100% + 0.5rem)' }} />
      <div aria-hidden className="absolute -left-[45.5px] top-4 h-[3px] w-6 bg-emerald-600/80 max-sm:hidden" />
      <div aria-hidden className="absolute -left-5 top-[0.8rem] h-2 w-2 rounded-full border-2 border-emerald-600 bg-white max-sm:hidden" />
      <div className="flex items-start gap-1 rounded-xl border border-emerald-200 bg-emerald-50/60 pr-1">
        <button
          type="button"
          aria-expanded={isOpenNow}
          aria-controls={panelId}
          onClick={() => ctx.toggle('b', band.key)}
          className={`flex min-w-0 flex-1 items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-emerald-100/50 ${FOCUS}`}
        >
          <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpenNow ? 'rotate-90' : ''}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {band.id && <span className="break-all font-mono text-xs font-semibold text-emerald-800">{band.id}</span>}
              <span className="break-words text-sm font-semibold text-slate-900">{band.name}</span>
              <span className="text-xs text-slate-500" title={`${band.compliant} of ${band.total} compliant`}>{band.compliant}/{band.total}</span>
            </span>
            {info?.objective && <span className="mt-0.5 line-clamp-2 text-xs text-slate-500">{info.objective}</span>}
          </span>
        </button>
        {hasMore && <AboutToggle open={about} onClick={() => setAbout((v) => !v)} label={`Details of ${band.id || band.name}`} controls={aboutId} />}
      </div>
      {about && hasMore && <StandardDetails id={aboutId} fields={fields} />}
      {isOpenNow && (
        <div id={panelId} className="mt-2 space-y-2 pl-4 sm:pl-6 max-sm:pl-0">
          {band.controls.map((control, i) => (
            <ControlCard key={control.id} control={control} last={i === band.controls.length - 1} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function FamilySection({ family, index, last, ctx }: { family: FamilyNode; index: number; last: boolean; ctx: Ctx }) {
  const isOpenNow = ctx.open('f', family.key);
  const [about, setAbout] = useState(false);
  const info = family.info;
  const panelId = domId('sec', family.key);
  const aboutId = domId('sec-about', family.key);
  const remaining = Math.max(0, family.total - family.compliant);
  const fields = [
    { label: 'Objective', text: info?.objective },
    { label: 'Performance indicators', items: info?.performance_indicators },
  ];
  const hasMore = fields.some((f) => (f.text && f.text.trim()) || (f.items && f.items.length > 0));

  return (
    <section data-testid="req-section" data-family={family.id ?? ''} className="relative pb-8 pl-16 last:pb-0 max-sm:pl-0">
      {/* The trunk down to the next section; the last section's trunk is the branches of its own bands. Below `sm` there is no spine:
          the circle sits inline with the heading and everything under it uses the full width. */}
      {!last && <div aria-hidden className="absolute left-[18.5px] top-10 h-[calc(100%-2.5rem)] w-[3px] rounded-full bg-emerald-600/80 max-sm:hidden" />}
      <div className="relative flex items-start gap-1">
        {isOpenNow && last && <div aria-hidden className="absolute -bottom-3 left-[-45.5px] top-10 w-[3px] bg-emerald-600/80 max-sm:hidden" />}
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={isOpenNow}
            aria-controls={panelId}
            onClick={() => ctx.toggle('f', family.key)}
            className={`relative -ml-16 flex w-[calc(100%+4rem)] items-start gap-3 rounded-xl pl-16 pr-2 text-left max-sm:ml-0 max-sm:w-full max-sm:pl-0 ${FOCUS}`}
          >
            <span
              className={`absolute left-0 top-0 z-10 grid h-10 w-10 place-items-center rounded-full border-[3px] bg-white text-sm font-semibold shadow-card ring-4 ring-white max-sm:relative max-sm:h-8 max-sm:w-8 max-sm:shrink-0 max-sm:text-xs ${
                family.compliant > 0 ? 'border-emerald-600 text-emerald-700' : 'border-slate-400 text-slate-600'
              }`}
            >
              {family.id ?? index + 1}
            </span>
            <span className="min-w-0 flex-1 pt-px max-sm:pt-1.5">
              <span className="flex items-start gap-2">
                <span className="min-w-0 break-words text-lg font-semibold leading-tight text-slate-900 max-sm:text-base max-sm:leading-tight">{family.title}</span>
                <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform max-sm:mt-0.5 ${isOpenNow ? 'rotate-90' : ''}`} aria-hidden />
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                <span className="font-medium text-emerald-700">{family.compliant}</span> of {family.total} compliant
                {remaining > 0 && <> · <span className="text-slate-700">{remaining}</span> to go</>}
              </span>
              {info?.objective && <span title={info.objective} className="mt-0.5 block truncate text-xs text-slate-500">{info.objective}</span>}
            </span>
          </button>
        </h3>
        {hasMore && <AboutToggle open={about} onClick={() => setAbout((v) => !v)} label={`Details of ${family.id ?? family.title}`} controls={aboutId} />}
      </div>
      {about && hasMore && <StandardDetails id={aboutId} fields={fields} />}
      {isOpenNow && (
        <div id={panelId} className="mt-3 space-y-2">
          {family.bands.map((band, i) => (
            <BandSection key={band.key} band={band} last={i === family.bands.length - 1} ctx={ctx} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function HierarchicalRequirements({
  journeyId, sections, structure, filtersActive, focusControlId, criteriaState, onToggleCriterion, onOpenControl, frameworkLabel, tenantUsers,
}: {
  journeyId: number;
  /** the page's own sections: its search, category and status filters and its sort are already applied */
  sections: SectionInput[];
  structure: ControlStructure;
  /** a search or filter is on: everything found is shown open */
  filtersActive: boolean;
  /** the control open in the requirement modal (also a deep link, `?req=`): its section and sub-family are opened */
  focusControlId: number | null;
  criteriaState: Record<number, Record<string, boolean>>;
  onToggleCriterion: (control: CertificationControl, index: number) => void;
  onOpenControl: (control: CertificationControl) => void;
  frameworkLabel: string;
  tenantUsers: PageUser[];
}) {
  const tree = buildTree(sections, structure);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  // What the session kept (a private window may refuse it: the tree then starts from its defaults).
  const [state, setState] = useState<OpenState>(() => {
    let kept = null;
    try { kept = parseLayer(window.sessionStorage.getItem(storageKey(journeyId))); } catch { /* not available */ }
    return initialState(tree, kept, focusControlId);
  });
  useEffect(() => {
    try { window.sessionStorage.setItem(storageKey(journeyId), JSON.stringify(state.normal)); } catch { /* not available */ }
  }, [journeyId, state.normal]);

  // What a search or filter opened is forgotten when the search or filter is switched on or off.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setState((s) => (Object.keys(s.filtered).length > 0 ? { ...s, filtered: {} } : s));
  }, [filtersActive]);

  // A control opened later (the requirement modal, or the back button landing on `?req=`) has its place opened.
  useEffect(() => {
    const layer = focusLayer(treeRef.current, focusControlId);
    if (Object.keys(layer).length > 0) setState((s) => ({ normal: { ...s.normal, ...layer }, filtered: { ...s.filtered, ...layer } }));
  }, [focusControlId]);

  const ctx: Ctx = {
    journeyId,
    open: (kind, key) => isOpen(state, filtersActive, kind, key),
    toggle: (kind, key) => setState((s) => toggled(s, filtersActive, kind, key)),
    criteriaState,
    onToggleCriterion,
    onOpenControl,
    frameworkLabel,
    users: tenantUsers,
  };
  const subs = totalProgress(treeControls(tree), criteriaState);

  return (
    <div data-testid="requirements-tree" className="min-w-0 [--color-muted:#586472]">
      <div data-testid="req-toolbar" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{subs.total > 0 ? `${subs.met} of ${subs.total} sub-controls met` : ''}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setState((s) => setAll(s, filtersActive, treeRef.current, true))} className={TOOL}>
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden /> Expand all
          </button>
          <button type="button" onClick={() => setState((s) => setAll(s, filtersActive, treeRef.current, false))} className={TOOL}>
            <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden /> Collapse all
          </button>
        </div>
      </div>
      <div className="relative">
        {tree.map((family, i) => (
          <FamilySection key={family.key} family={family} index={i} last={i === tree.length - 1} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
