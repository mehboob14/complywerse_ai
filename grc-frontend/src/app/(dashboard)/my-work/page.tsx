'use client';

// My Work: what is assigned to the signed-in person in the control plane and in their framework journeys: the SCF controls they own or are assigned (GET scf/my-work: controls, N/A reviews waiting,
// overdue re-attestations, artifacts to write or review, failing checks), the journey requirements assigned to them (one read of each framework's controls), the frameworks they work in with their
// progress, and "This week". The page's rules are in workModel.ts (moved unchanged, tested against the old code). Who sees it is what it has always been: an administrator, or a person with framework,
// control-library or evidence access; everyone else is told it is not available for their role. What changed is that nothing is passed off as empty: a read that fails says so with Retry (the SCF
// block used to read "No SCF controls assigned to you" and "Nothing overdue"), and a framework whose controls could not be read is named instead of counting as "nothing assigned". Built on the kit.
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { certificationsApi, scfApi, type ScfMyWorkItem } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount, formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, NoAccessState, Notice, ProgressBar, SectionCard, SkeletonRows, StatusPill, type ProgressTone } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { routeFor } from '@/lib/navRegistry';
import { retryRead } from '../tasks/_queries';
import { useMe } from '../tasks/_work/workData';
import { canOpenMyWork } from './myWorkAccess';
import {
  STATUS_LABELS, failedNames, frameworksOf, mineOf, scfCode, scfOverdue, scfTitle, weekOf, workItems,
  type Ctrl, type Journey, type Per,
} from './workModel';

const TITLE = routeFor('/my-work')?.label ?? 'My work';
const ROW = 'flex items-center gap-[12px] rounded-ds-control px-[12px] py-[10px] hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';
const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** A line of a list: the code and the title, what it is, and when it is due; the whole line opens the control when there is somewhere to go. */
function Row({ href, code, title, pills, status, due, overdue, mark }: {
  href: string | null; code: string; title: string; pills?: ReactNode; status?: string; due?: string | null; overdue?: boolean; mark?: ReactNode;
}) {
  const body = (
    <>
      {mark}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
          {code && <span className="font-mono text-ds-body text-ds-primary-text">{code}</span>}
          <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{title}</span>
          {pills}
        </div>
        {status && <p className="mt-[2px] text-ds-label text-ds-fg-muted">{status}</p>}
      </div>
      {overdue ? <StatusPill size="sm" tone="danger" label={due ? `Overdue · ${due}` : 'Overdue'} /> : due ? <span className="shrink-0 text-ds-label text-ds-fg-muted">{due}</span> : null}
      {href && <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />}
    </>
  );
  return <li>{href ? <Link href={href} className={ROW}>{body}</Link> : <div className={ROW}>{body}</div>}</li>;
}

const List = ({ children }: { children: ReactNode }) => <ul className="m-0 flex list-none flex-col p-0">{children}</ul>;

function ScfSection({ id, title, hint, items, empty, hrefFor, badge }: {
  id: string; title: string; hint?: string; items: ScfMyWorkItem[]; empty: string; hrefFor: (item: ScfMyWorkItem) => string | null; badge?: (item: ScfMyWorkItem) => { tone: 'warning' | 'danger' | 'neutral'; label: string } | null;
}) {
  const now = Date.now();
  return (
    <SectionCard id={id} title={title} meta={`${formatCount(items.length)}${hint ? ` · ${hint}` : ''}`}>
      {items.length === 0 ? <p className="py-[8px] text-center text-ds-body text-ds-fg-muted">{empty}</p> : (
        <List>
          {items.map((item, i) => {
            const b = badge?.(item);
            const st = item.status || item.overall_status;
            return (
              <Row
                key={`${scfCode(item)}-${i}`}
                href={hrefFor(item)}
                code={scfCode(item)}
                title={scfTitle(item)}
                pills={b ? <StatusPill size="sm" tone={b.tone} label={b.label} /> : null}
                status={st ? STATUS_LABELS[String(st)] || String(st) : undefined}
                due={item.next_due_at ? formatDate(item.next_due_at as string) : null}
                overdue={scfOverdue(item, now)}
              />
            );
          })}
        </List>
      )}
    </SectionCard>
  );
}

const barTone = (pct: number): ProgressTone => (pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'danger');
const controlHref = (item: ScfMyWorkItem) => { const code = scfCode(item); return code ? `/automation/soc2-controls/${encodeURIComponent(code)}` : null; };

export default function MyWorkPage() {
  const { hasAnyPermission, isAdmin, isLoading: permLoading } = usePermissions();
  const canView = canOpenMyWork(isAdmin, hasAnyPermission);
  const me = useMe();
  const userId = me.id;
  const enabled = userId != null && canView;

  const journeys = useQuery({
    queryKey: ['my-work', userId],
    queryFn: async () => {
      const list = ((await certificationsApi.getAll()).data as Journey[]) || [];
      const per: Per[] = await Promise.all(list.map(async (journey) => {
        try {
          const controls = ((await certificationsApi.getControls(journey.id)).data as Ctrl[]) || [];
          return { journey, mine: mineOf(controls, userId as number), total: controls.length };
        } catch { return { journey, mine: [] as Ctrl[], total: 0, failed: true }; }          // named in a notice below: it is not "nothing assigned"
      }));
      return { per };
    },
    enabled,
    retry: retryRead,
  });
  const scfQ = useQuery({
    queryKey: ['scf-my-work', userId],
    queryFn: async () => (await scfApi.myWork()).data,
    enabled,
    retry: retryRead,
  });

  const now = Date.now();
  const per = useMemo(() => journeys.data?.per ?? [], [journeys.data]);
  const items = useMemo(() => workItems(per, now), [per, now]);
  const frameworks = useMemo(() => frameworksOf(per), [per]);
  const week = useMemo(() => weekOf(per, items, now), [per, items, now]);
  const failed = failedNames(per);

  const scf = scfQ.data;
  const scfControls = scf?.controls || [];
  const scfNa = scf?.na_reviews || [];
  const scfOver = scf?.overdue || [];
  const scfArtifacts = (scf?.artifacts || []) as ScfMyWorkItem[];
  const scfFailing = scf?.failing || [];
  const scfOpenCount = scfControls.length + scfNa.length + scfOver.length + scfArtifacts.length + scfFailing.length;
  const openItems = items.filter((i) => !i.done);
  const overdueCount = items.filter((i) => i.overdue).length;

  if (canView && !permLoading && me.failed) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={TITLE} back={{ href: '/tasks', label: 'Back to Task Management' }} />
        <ErrorState title="Couldn't tell who you are" message="Your work can't be listed until your account is read. Try again, or sign in again." onRetry={me.refetch} />
      </div>
    );
  }
  if (permLoading || (canView && (journeys.isPending || userId == null))) {
    return <div role="status" aria-label="Loading your work" className="flex flex-col gap-[16px]"><PageHeader variant="page" title={TITLE} back={{ href: '/tasks', label: 'Back to Task Management' }} /><SkeletonRows rows={6} columns={3} /></div>;
  }
  if (!canView) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={TITLE} back={{ href: '/tasks', label: 'Back to Task Management' }} />
        <NoAccessState title="My Work isn’t available for your role" reason="You need framework or evidence access to see assigned work." action={<Button href="/dashboard">Back to Performance Overview</Button>} />
      </div>
    );
  }

  const facts = journeys.isError ? null : `${plural(openItems.length, 'journey item', 'journey items')}${scfQ.data ? ` · ${plural(scfOpenCount, 'control item', 'control items')}` : ''} across ${plural(frameworks.length, 'framework', 'frameworks')}`;
  const overdue = overdueCount + scfOver.length;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={TITLE}
        meta={facts ? <>{facts}{overdue > 0 && <span className="font-[600] text-ds-danger"> · {formatCount(overdue)} overdue</span>}</> : undefined}
        back={{ href: '/tasks', label: 'Back to Task Management' }}
      />
      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-[16px] lg:col-span-2">
          {scfQ.isError ? (
            <ErrorState title="Couldn't load your controls" message={errorMessage(scfQ.error)} onRetry={canRetry(scfQ.error) ? () => { void scfQ.refetch(); } : undefined} />
          ) : scfQ.isPending ? (
            <SkeletonRows rows={4} columns={3} label="Loading your controls" />
          ) : (
            <>
              <ScfSection id="scf-controls" title="Controls you own or are assigned" items={scfControls} empty="No controls assigned to you." hrefFor={controlHref} />
              <ScfSection id="scf-na" title="N/A reviews waiting" items={scfNa} empty="No applicability reviews waiting on you." hrefFor={controlHref} badge={() => ({ tone: 'warning', label: 'N/A review' })} />
              <ScfSection id="scf-overdue" title="Overdue re-attestations" items={scfOver} empty="Nothing overdue." hrefFor={controlHref} badge={() => ({ tone: 'danger', label: 'Overdue' })} />
              <ScfSection
                id="scf-artifacts"
                title="Artifacts to write or review"
                items={scfArtifacts}
                empty="No artifacts in your queue."
                hrefFor={(item) => { const code = String(item.scf_id || item.control_ref || item.control_id || ''); return code ? `/automation/soc2-controls/${encodeURIComponent(code)}` : null; }}
                badge={(item) => (item.status ? { tone: 'neutral', label: String(item.status).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) } : null)}
              />
              {scfFailing.length > 0 && <ScfSection id="scf-failing" title="Failing checks" items={scfFailing} empty="No failing checks." hrefFor={controlHref} badge={() => ({ tone: 'danger', label: 'Failing' })} />}
            </>
          )}

          <SectionCard id="journey-items" title="Journey requirements assigned to you" meta="most urgent first">
            {failed.length > 0 && (
              <Notice tone="warning" title={`${plural(failed.length, 'framework', 'frameworks')} could not be read`} className="mb-[12px]">
                {failed.join(', ')}: anything assigned to you there is not listed. Reload the page to try again.
              </Notice>
            )}
            {journeys.isError ? (
              <ErrorState compact title="Couldn't load your frameworks" message={errorMessage(journeys.error)} onRetry={canRetry(journeys.error) ? () => { void journeys.refetch(); } : undefined} />
            ) : items.length === 0 ? (
              <EmptyState bare kind="firstUse" title="Nothing is assigned to you right now" info="Requirements of a framework journey that are assigned to you appear here." />
            ) : (
              <List>
                {items.map((i) => (
                  <Row
                    key={`${i.journeyId}-${i.controlId}`}
                    href={`/frameworks/${i.journeyId}?tab=controls&req=${i.controlId}`}
                    code={i.code}
                    title={i.title}
                    pills={i.isCritical ? <StatusPill size="sm" tone="danger" label="Critical" /> : null}
                    status={`${i.frameworkName} · ${STATUS_LABELS[i.status] || i.status}${i.required > 0 ? ` · ${i.approved}/${i.required} evidence approved` : ''}`}
                    due={i.due != null ? formatDate(i.due, { calendar: true }) : null}
                    overdue={i.overdue}
                    mark={<span aria-hidden className={`h-[10px] w-[10px] shrink-0 rounded-full border ${i.active ? 'border-ds-warning bg-ds-warning' : i.done ? 'border-ds-success bg-ds-success' : 'border-ds-border-strong'}`} />}
                  />
                ))}
              </List>
            )}
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-col gap-[16px]">
          <SectionCard id="your-frameworks" title="Your frameworks">
            {frameworks.length === 0 ? <p className="text-ds-body text-ds-fg-muted">No assigned frameworks yet.</p> : (
              <ul className="m-0 flex list-none flex-col gap-[16px] p-0">
                {frameworks.map((f) => (
                  <li key={f.id}>
                    <Link href={`/frameworks/${f.id}?tab=controls`} className="block rounded-ds-control focus-visible:outline-none focus-visible:shadow-ds-ring">
                      <div className="mb-[4px] flex items-baseline justify-between gap-[8px]"><span className="min-w-0 truncate text-ds-body font-[600] text-ds-fg">{f.name}</span><span className="text-ds-label tabular-nums text-ds-fg-muted">{f.pct}%</span></div>
                      <ProgressBar value={Math.min(100, Math.max(0, f.pct))} label={`${f.name}: progress`} showValue={false} tone={barTone(f.pct)} />
                      <p className="mt-[4px] text-ds-label text-ds-fg-muted">{formatCount(f.myCount)} of your {f.myCount === 1 ? 'item' : 'items'}{f.phase ? ` · Phase ${f.phase}` : ''}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard id="this-week" title="This week">
            <dl className="m-0 flex flex-col gap-[8px]">
              {([['Items completed', week.completed, 'text-ds-success'], ['Evidence approved', week.evidenceApproved, 'text-ds-fg'], ['Awaiting reviewer', week.awaitingReviewer, 'text-ds-warning'], ['Due next 7 days', week.dueNext7, 'text-ds-fg'], ['Controls overdue', scfOver.length, 'text-ds-danger']] as Array<[string, number, string]>).map(([label, value, tone]) => (
                <div key={label} className="flex items-center justify-between gap-[12px]"><dt className="text-ds-body text-ds-fg-muted">{label}</dt><dd className={`m-0 text-ds-body font-[600] tabular-nums ${tone}`}>{formatCount(value)}</dd></div>
              ))}
            </dl>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
