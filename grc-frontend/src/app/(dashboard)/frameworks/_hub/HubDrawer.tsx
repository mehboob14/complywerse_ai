'use client';

/**
 * The details of one library framework over the Library list (the Facet explorer's drawer): the kit's SidePanel. It is what the old "Overview" page and the Start-a-journey dialog were: where the
 * framework stands (its state, and the one next step the gate allows, with an optional target date when the journey can start), what it is (kind, who stands behind it, requirements, validity,
 * deadline, levels) and what it says (purpose, scope, audience, objectives, adoption approach, required artifacts, what happens if it is not met, why it is classified as it is). A section the
 * framework has nothing for is not drawn; nothing is invented. The old page's fixed "Certification Lifecycle" row, its default artifact list and its "% confidence" are gone.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks, Play, Sparkles, Trash2 } from 'lucide-react';
import {
  Button, ChipList, ClampedText, Disclosure, Fact, FactList, FormField, IconButton, Menu, Notice, SidePanel, StatusPill, TextInput, type MenuItem,
} from '@/components/ui/ds';
import Link from 'next/link';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { frameworkState } from '@/lib/statuses/frameworkHub';
import { OnboardingNeeded } from '@/components/compliance/onboarding/gate/OnboardingNeeded';
import { canStartAnother, kindLabel, nextStep, todayDay, typeLabel, type HubRow, type LibraryItem } from './hubModel';
import { overviewOf, versionLabel } from './overviewModel';
import { NextButton, ReadyCell, type RowEnv } from './HubRows';

const H3 = 'm-0 mb-[6px] !text-ds-body !font-[600] !text-ds-fg';
const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

function List({ items }: { items: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
      {items.map((line, i) => <li key={i} dir="auto" className="flex gap-[8px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]"><span aria-hidden className="mt-[8px] h-[4px] w-[4px] shrink-0 rounded-full bg-ds-fg-muted" /><span className="min-w-0">{line}</span></li>)}
    </ul>
  );
}

export interface HubDrawerProps {
  row: HubRow | null;
  item: LibraryItem | null;
  env: RowEnv;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export function HubDrawer({ row, item, env, onClose, onStep, hasPrev, hasNext }: HubDrawerProps) {
  const id = row?.id ?? null;
  const a = env.actions;
  const menu: MenuItem[] = !row ? [] : [
    { key: 'requirements', label: 'View requirements', icon: ListChecks, onSelect: () => env.go(`/controls?framework=${row.frameworkId}`), hidden: row.frameworkId == null },
    { key: 'again', label: 'Start a new journey', icon: Play, onSelect: () => a.start(row), hidden: !canStartAnother(row) },
    { key: 'enhance', label: 'Generate evidence recommendations', icon: Sparkles, onSelect: () => a.enhance(row), disabled: a.enhancing === row.frameworkId },
    { key: 'delete', label: 'Delete framework', icon: Trash2, danger: true, onSelect: () => a.removeFramework(row), hidden: !a.canDelete || row.shared },
  ];
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.name}>{row?.name ?? ''}</span>}
      subtitle={row ? [typeLabel(row.typeKey), versionLabel(row.version)].filter(Boolean).join(' · ') : undefined}
      dockFrom={Infinity}
      width="md"
      padded={false}
      restoreFocus={rowOf(id)}
      actions={row && (
        <>
          <IconButton label="Previous framework" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next framework" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          <Menu label={`More about ${truncate(row.name, 40).text}`} iconOnly items={menu} />
        </>
      )}
    >
      {row && <Body key={row.id} row={row} item={item} env={env} />}
    </SidePanel>
  );
}

function Body({ row, item, env }: { row: HubRow; item: LibraryItem | null; env: RowEnv }) {
  const a = env.actions;
  const [target, setTarget] = useState('');
  const step = nextStep(row);
  const sections = item ? overviewOf(item) : null;
  const refused = a.refusal && a.refusal.frameworkId === row.frameworkId ? a.refusal : null;
  const starts = step?.kind === 'start' && !refused;                  // once the server has refused, its notice carries the way forward
  const authorityLabel = row.kind === 'certification' ? 'Certification body' : 'Regulator';

  return (
    <div className="flex flex-col gap-[20px] p-[16px]">
      <section aria-label="Where it stands" className="flex flex-col gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
        <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px]">
          <StatusPill {...statusPill(frameworkState, row.state)} />
          {row.stateNote && <span className="text-ds-label text-ds-fg-muted">{row.stateNote}</span>}
        </div>
        {row.numbers && (
          <div className="max-w-[260px]"><ReadyCell row={row} /></div>
        )}
        {row.state === 'unknown' && <p className="m-0 text-ds-label text-ds-fg-muted">Where its onboarding stands could not be read. Starting the journey asks the server, which decides.</p>}
        {row.state === 'idle' && <p className="m-0 text-ds-label text-ds-fg-muted">Its journey starts once its onboarding is approved: its scope, owners and dates, settled once.</p>}
        {refused && (
          <OnboardingNeeded frameworkId={refused.frameworkId} onboardingId={refused.why.onboardingId} state={refused.why.state ?? 'not_started'} open={refused.why.open} />
        )}
        {starts && (
          <FormField label="Target date" optional info="Used for due-date warnings. You can set or change it later on the journey.">
            <TextInput type="date" value={target} min={todayDay()} onChange={(e) => setTarget(e.target.value)} className="max-w-[200px]" />
          </FormField>
        )}
        <div className="flex flex-wrap items-center gap-[8px]">
          {step && step.kind === 'start'
            ? refused ? null : <Button variant="primary" leftIcon={<Play aria-hidden />} loading={a.starting === step.frameworkId} onClick={() => a.start(row, target || undefined)}>{step.label}</Button>
            : <NextButton row={row} env={env} size="md" />}
          {row.journey && row.journey.target_date && <span className="text-ds-label text-ds-fg-muted">{`Target ${formatDate(row.journey.target_date, { calendar: true })}`}</span>}
        </div>
      </section>

      <FactList min={150}>
        <Fact label={authorityLabel}>{row.authority}</Fact>
        <Fact label="Kind">{kindLabel(row.kind)}</Fact>
        <Fact label="Requirements">
          {row.requirements != null && row.frameworkId != null
            ? <Link href={`/controls?framework=${row.frameworkId}`} className={`rounded-ds-control text-ds-primary-text hover:underline ${FOCUS}`}>{`${formatCount(row.requirements)} ${row.requirements === 1 ? 'requirement' : 'requirements'}`}</Link>
            : null}
        </Fact>
        <Fact label="Valid for">{sections?.validity || null}</Fact>
        <Fact label="Compliance deadline">{item?.compliance_deadline ? formatDate(item.compliance_deadline, { calendar: true }) : null}</Fact>
        <Fact label="Audience">{sections?.audience || null}</Fact>
      </FactList>

      {sections && sections.levels.length > 0 && (
        <section aria-label="Certification levels"><h3 className={H3}>Certification levels</h3><ChipList label="levels" items={sections.levels} shown={4} /></section>
      )}
      {sections?.purpose && <section aria-label="Purpose"><h3 className={H3}>Purpose</h3><ClampedText text={sections.purpose} lines={5} /></section>}
      {sections?.scope && <section aria-label="Scope"><h3 className={H3}>Scope</h3><ClampedText text={sections.scope} lines={5} /></section>}
      {sections && sections.objectives.length > 0 && <section aria-label="Objectives"><h3 className={H3}>Objectives</h3><List items={sections.objectives} /></section>}
      {sections && sections.approach.length > 0 && <section aria-label="Adoption approach"><h3 className={H3}>How to adopt it</h3><List items={sections.approach} /></section>}
      {sections && sections.artifacts.length > 0 && <section aria-label="Required artifacts"><h3 className={H3}>What it asks you to keep</h3><List items={sections.artifacts} /></section>}
      {sections?.penalty && (
        <Notice tone="warning" title="If it is not met"><span dir="auto" className="[overflow-wrap:anywhere]">{sections.penalty}</span></Notice>
      )}
      {sections?.reasoning && (
        <Disclosure label="Why it is classified this way" region={false} level={3}><ClampedText text={sections.reasoning} lines={6} /></Disclosure>
      )}
    </div>
  );
}
