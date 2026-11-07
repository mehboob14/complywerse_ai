'use client';

/**
 * The details of one risk over the register's list (the Facet explorer's drawer): the kit's SidePanel, one scrolling body. It asks for the whole record when it opens (the lean list
 * holds a row, not the long text): the people, the two scores, the dates, what the risk says (description, plan, root cause, consequences, recommendations, each clamped with the
 * whole text one press away), what it is linked to as counts that open the risk on the right tab, and the register's own fields (NCA and the like). Open risk, Edit and Delete stay
 * in view; previous / next walk the list as it is shown.
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import { Button, ClampedText, ErrorState, Fact, FactList, IconButton, Menu, PersonChip, SidePanel, Skeleton, StatusPill, TitleLink, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { EMPTY, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel, riskSla, riskSource, riskStatus } from '@/lib/statuses/risk';
import { LevelCell } from './RiskRows';
import { sourceOf } from './riskInsights';
import { categoryKey, categoryLabel, levelOf, reviewOf, type RiskRow } from './riskModel';

export interface RiskFull {
  [key: string]: unknown;
  id: number;
  title: string;
  description?: string | null;
  treatment_plan?: string | null;
  root_cause?: string | null;
  consequences?: string | null;
  recommendations?: string | null;
  owner_name?: string | null;
  business_owner_name?: string | null;
  business_unit_name?: string | null;
  risk_appetite?: string | null;
  priority?: string | null;
  effective_priority?: string | null;
  source_type?: string | null;
  source_label?: string | null;
  template_fields?: Record<string, unknown> | null;
  linked_controls?: unknown[];
  linked_internal_controls?: unknown[];
  linked_framework_controls?: unknown[];
  linked_framework_requirements?: unknown[];
  linked_assets?: unknown[];
  linked_evidence?: unknown[];
  linked_governance?: unknown[];
  actions_total?: number;
  actions_open?: number;
  created_at?: string;
  updated_at?: string;
}

export interface RiskDrawerProps {
  /** the lean row of the risk whose details are open; null = closed */
  row: RiskRow | null;
  now: Date;
  reviews: ReadonlyMap<number, string>;
  onClose: () => void;
  onOpenRisk: (id: number, tab?: string) => void;
  onEdit: (row: RiskRow) => void;
  canEdit: boolean;
  onDelete: (row: RiskRow) => void;
  canDelete: boolean;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

const count = (x: unknown): number => (Array.isArray(x) ? x.length : 0);

/** "risk_cause" -> "Risk cause". */
const humanise = (key: string): string => { const w = key.replace(/_/g, ' ').trim(); return w ? w.charAt(0).toUpperCase() + w.slice(1) : key; };

/** The register's own fields (NCA and the like) that hold words: text, numbers, yes / no. Empty and structured values are left out. */
export function registerFields(fields: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  return Object.entries(fields ?? {})
    .filter(([, v]) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => ({ label: humanise(k), value: typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v) }));
}

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-[20px] border-t border-ds-border pt-[16px]">
      <h3 className="!text-ds-body !font-[600] !text-ds-fg">{title}</h3>
      <div className="mt-[8px]">{children}</div>
    </section>
  );
}

export function RiskDrawer({ row, now, reviews, onClose, onOpenRisk, onEdit, canEdit, onDelete, canDelete, onStep, hasPrev, hasNext }: RiskDrawerProps) {
  const id = row?.id ?? null;
  const q = useQuery({
    queryKey: ['erm-risk-detail', id],
    queryFn: async () => (await ermApi.risks.getDetail(id as number)).data as unknown as RiskFull,
    enabled: id != null,
    retry: (failures, e) => failures < 2 && canRetry(e),
  });
  const full = q.data && q.data.id === id ? q.data : null;
  const more: MenuItem[] = row ? [{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => onDelete(row) }] : [];
  const review = row ? reviewOf(row, reviews, now) : null;
  const sub = row ? [categoryLabel(categoryKey(row)), row.register_type?.trim()].filter(Boolean).join(' · ') : '';
  const fields = registerFields(full?.template_fields);
  const links: [string, number, string][] = full ? [
    ['Controls', count(full.linked_controls) + count(full.linked_internal_controls) + count(full.linked_framework_controls) + count(full.linked_framework_requirements), 'controls'],
    ['Assets', count(full.linked_assets), 'assets'],
    ['Evidence', count(full.linked_evidence), 'evidence'],
    ['Documents', count(full.linked_governance), 'documents'],
    ['Mitigation actions', full.actions_total ?? 0, 'treatment'],
  ] : [];
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.title}>{row?.title}</span>}
      subtitle={sub || undefined}
      dockFrom={Infinity}
      width="md"
      restoreFocus={rowOf(id)}
      actions={row && (
        <>
          <IconButton label="Previous risk" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next risk" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          {more.some((m) => !m.hidden) && <Menu label="More actions" iconOnly items={more} />}
        </>
      )}
      footer={row && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button variant="primary" onClick={() => onOpenRisk(row.id)} rightIcon={<ArrowUpRight aria-hidden />}>Open risk</Button>
          {canEdit && <Button onClick={() => onEdit(row)} leftIcon={<Pencil aria-hidden />}>Edit</Button>}
        </div>
      )}
    >
      {row && (
        <div key={row.id} data-risk-detail={row.id}>
          <div className="mb-[16px] flex flex-wrap items-center gap-[8px]">
            <StatusPill {...statusPill(riskStatus, row.status || 'open')} />
            <LevelCell row={row} />
            {row.sla?.state && row.sla.state !== 'no_due_date' && row.sla.state !== 'closed' && <StatusPill size="sm" {...statusPill(riskSla, row.sla.state)} />}
          </div>

          <FactList min={150}>
            <Fact label="Risk owner" empty="Unassigned">{row.owner_name ? <PersonChip name={row.owner_name} /> : null}</Fact>
            <Fact label="Business owner" empty="Unassigned">{row.business_owner_name ? <PersonChip name={row.business_owner_name} /> : null}</Fact>
            <Fact label="Business unit" empty="Not set">{row.business_unit_name}</Fact>
            <Fact label="Priority">{row.effective_priority ? riskLevel.label(row.effective_priority) : null}</Fact>
            <Fact label="Inherent score">{row.inherent_score != null ? `${Math.round(row.inherent_score)} (likelihood ${row.inherent_likelihood ?? EMPTY}, impact ${row.inherent_impact ?? EMPTY})` : null}</Fact>
            <Fact label="Residual score">{row.residual_score != null ? `${Math.round(row.residual_score)} (likelihood ${row.residual_likelihood ?? EMPTY}, impact ${row.residual_impact ?? EMPTY})` : null}</Fact>
            <Fact label="Next review" empty="Not scheduled">{review?.due ? `${formatDate(review.due)}${review.state === 'overdue' ? ' (overdue)' : ''}` : null}</Fact>
            <Fact label="Due">{row.due_date ? formatDate(row.due_date) : null}</Fact>
            <Fact label="Source">{full?.source_label || riskSource.label(sourceOf(row))}</Fact>
            <Fact label="Last changed">{row.updated_at ? formatDate(row.updated_at) : null}</Fact>
          </FactList>

          {q.isPending && <div className="mt-[20px]"><Skeleton className="h-[14px] w-[60%]" /><Skeleton className="mt-[8px] h-[14px] w-[90%]" /><Skeleton className="mt-[8px] h-[14px] w-[75%]" /></div>}
          {q.isError && !full && (
            <ErrorState compact className="mt-[16px]" title="Couldn't load the rest of this risk" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
          )}

          {full && (
            <>
              <Section title="Description"><ClampedText text={full.description} lines={4} /></Section>
              {full.treatment_plan && <Section title="Treatment plan"><ClampedText text={full.treatment_plan} lines={4} /></Section>}
              {full.root_cause && <Section title="Root cause"><ClampedText text={full.root_cause} lines={4} /></Section>}
              {full.consequences && <Section title="Consequences"><ClampedText text={full.consequences} lines={4} /></Section>}
              {full.recommendations && <Section title="Recommendations"><ClampedText text={full.recommendations} lines={4} /></Section>}
              <Section title="Linked to">
                <ul className="m-0 list-none p-0">
                  {links.map(([label, n, tab]) => (
                    <li key={tab} className="flex items-center justify-between gap-[8px] border-b border-ds-border py-[2px] last:border-b-0">
                      <TitleLink href={`/erm/risks/${row.id}?tab=${tab}`} title={label} lines={1} tone="text" size="body" />
                      <span className="tabular-nums text-ds-body text-ds-fg-muted">{n}{tab === 'treatment' && (full.actions_open ?? 0) > 0 ? ` (${full.actions_open} open)` : ''}</span>
                    </li>
                  ))}
                </ul>
              </Section>
              {fields.length > 0 && (
                <Section title="Register fields">
                  <FactList min={200}>{fields.map((f) => <Fact key={f.label} label={f.label}>{f.value}</Fact>)}</FactList>
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </SidePanel>
  );
}

export { levelOf };
