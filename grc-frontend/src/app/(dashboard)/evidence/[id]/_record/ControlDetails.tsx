'use client';

/**
 * The details of one common control, opened from the Linked tab and from a control suggestion: what it is, what it asks, who owns it, and the framework requirements it fulfils (so a
 * person can see what a file linked to it is worth), with how this evidence is linked to it. The control's own page has the rest; this is the part needed to judge a link.
 *
 * It opens at once with what the record page already knows (the requirement codes), then fills in from the control's detail endpoint; if that cannot be read it says so and keeps what
 * it has. A dialog of the kit's AnimatedModal: named, focus in and back, Escape closes it.
 */
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import apiClient from '@/lib/api';
import { AnimatedModal } from '@/components/ui';
import { AccordionRow, Button, Fact, FactList, Notice, StatusPill } from '@/components/ui/ds';
import { statusOf } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import type { FulfilledRequirements } from './recordTypes';

/** What the Linked tab hands the dialog about the row that was pressed. */
export interface ControlRef {
  scfId: string;
  title?: string | null;
  /** how this evidence is linked to the control (the artifact it was linked as, and how fully) */
  linkedAs?: string | null;
  coverage?: string | null;
  /** the requirements the record page already has, codes only: shown until the detail arrives */
  requirements?: FulfilledRequirements[];
}

interface ReqItem { code: string; reference?: string | null; title?: string | null; text?: string | null; resolved?: boolean }
interface ReqGroup { framework: string; label: string; count: number; inferred_count?: number; items: ReqItem[] }
interface ControlDetail {
  control_id: string;
  title: string;
  description?: string | null;
  control_question?: string | null;
  category?: string | null;
  conformity_cadence?: string | null;
  is_material?: boolean;
  owner_name?: string | null;
  ownership_status?: string | null;
  designation?: string | null;
  checks_count?: number;
  overall_status?: string | null;
  requirement_groups?: ReqGroup[];
  requirement_count?: number;
  framework_count?: number;
}

const OWNERSHIP: Record<string, string> = { unowned: 'No owner yet', owned: 'Owned', overdue: 'Overdue', due_soon: 'Due soon' };
// what the checks of a control add up to, said the way the control's own page says it
const CHECKS: Record<string, string> = { connect_one: 'connect a source to run them', not_run: 'not run yet', passed: 'passing', failed: 'failing', partial: 'partly passing', manual: 'manual' };
const words = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '');
const sentence = (s?: string | null) => { const t = words(s); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
const MUTED = 'text-ds-fg-muted';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[6px]">
      <h3 className={`!text-ds-label !font-[600] ${MUTED}`}>{title}</h3>
      {children}
    </section>
  );
}

export default function ControlDetails({ control, onClose }: { control: ControlRef; onClose: () => void }) {
  const q = useQuery<ControlDetail>({
    queryKey: ['common-control-detail', control.scfId],
    queryFn: async () => (await apiClient.get(`/automation/common/controls/${encodeURIComponent(control.scfId)}`)).data,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const d = q.data;
  const groups = d?.requirement_groups ?? [];
  const known = control.requirements ?? [];                                     // until the detail arrives (or if it cannot be read), the codes already known
  const total = d?.requirement_count ?? known.reduce((n, g) => n + g.codes.length, 0);
  const frameworks = d?.framework_count ?? (groups.length || known.length);
  const title = d?.title || control.title || control.scfId;

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title={<span className="flex items-center gap-[8px]"><ShieldCheck aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" /><span className={`text-ds-body ${MUTED}`}>{control.scfId}</span> {title}</span>}
      subtitle={[d?.category, d?.conformity_cadence && `${words(d.conformity_cadence)} review`, d?.is_material && 'Material'].filter(Boolean).join(' · ') || undefined}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <Button variant="link" href={`/automation/soc2-controls/${encodeURIComponent(control.scfId)}`} rightIcon={<ExternalLink aria-hidden />}>Open the control</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[20px] p-[20px]">
        {(control.linkedAs || control.coverage) && (
          <Section title="This evidence">
            <p className="flex flex-wrap items-center gap-[8px] text-ds-body text-ds-fg-body">
              {control.linkedAs ? <span>Linked as <span className="font-[500] text-ds-fg">“{control.linkedAs}”</span></span> : <span>Linked to this control</span>}
              {control.coverage && <StatusPill size="sm" tone="neutral" label={`${sentence(control.coverage)} coverage`} />}
            </p>
          </Section>
        )}

        {q.isLoading && <p role="status" className={`flex items-center gap-[8px] text-ds-body ${MUTED}`}><Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none" />Loading the control…</p>}
        {q.isError && (
          <Notice tone="warning">
            The control’s details could not be loaded{statusOf(q.error) === 403 ? ' — your account may not have access to the control library' : ''}. What this evidence already knows is shown below.
          </Notice>
        )}

        {d && (
          <>
            {(d.description || d.control_question) && (
              <Section title="What the control requires">
                {d.description && <p className="whitespace-pre-line text-ds-body text-ds-fg-body">{d.description}</p>}
                {d.control_question && <p className="whitespace-pre-line rounded-ds-card bg-ds-surface-hover px-[12px] py-[8px] text-ds-label text-ds-fg-body">{d.control_question}</p>}
              </Section>
            )}
            <FactList min={150}>
              <Fact label="Owner">{d.owner_name || OWNERSHIP[d.ownership_status || ''] || words(d.ownership_status)}</Fact>
              <Fact label="Assessment">{sentence(d.designation) || 'Not assessed'}</Fact>
              <Fact label="Automated checks">{d.checks_count ? `${plural(d.checks_count, 'check')} · ${CHECKS[d.overall_status || ''] ?? words(d.overall_status)}` : 'None'}</Fact>
              <Fact label="Requirements">{total ? `${formatCount(total)} in ${plural(frameworks, 'framework')}` : 'None in scope'}</Fact>
            </FactList>
          </>
        )}

        <Section title={`Framework requirements it fulfils${total ? ` · ${formatCount(total)}` : ''}`}>
          {groups.length > 0 ? (
            <div className="rounded-ds-card border border-ds-border">
              {groups.map((g, i) => (
                <AccordionRow
                  key={g.framework} title={g.label} defaultOpen={i === 0} level={4} region={false}
                  meta={g.inferred_count ? (g.inferred_count === g.count ? 'All matched through a parent or child requirement' : `${formatCount(g.inferred_count)} matched through a parent or child requirement`) : undefined}
                  trailing={<span className={`text-ds-label tabular-nums ${MUTED}`}>{formatCount(g.count)}</span>}
                >
                  <ul className="m-0 list-none divide-y divide-ds-border border-t border-ds-border p-0">
                    {g.items.map((it) => (
                      <li key={it.code} className="px-[12px] py-[8px]">
                        <p className="break-words text-ds-body text-ds-fg"><span className="font-[600]">{it.reference || it.code}</span>{it.title ? ` ${it.title}` : ''}</p>
                        {it.text && <p className="mt-[2px] break-words text-ds-label text-ds-fg-body">{it.text}</p>}
                        {!it.title && !it.text && it.resolved === false && <p className={`mt-[2px] text-ds-label ${MUTED}`}>No wording for this requirement in the library.</p>}
                      </li>
                    ))}
                  </ul>
                </AccordionRow>
              ))}
            </div>
          ) : known.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0 text-ds-body text-ds-fg-body">
              {known.map((g) => <li key={g.key}><span className="font-[600] text-ds-fg">{g.label}</span> <span className={MUTED}>· {g.codes.join(', ')}</span></li>)}
            </ul>
          ) : !q.isLoading ? (
            <p className={`text-ds-body ${MUTED}`}>No requirement of an in-scope framework is mapped to this control.</p>
          ) : null}
        </Section>
      </div>
    </AnimatedModal>
  );
}
