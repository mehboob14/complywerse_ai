'use client';

// The planning tabs of a project: Budget & Financials, Compliance Mapping and Dependencies. Each loads its own list when it is opened (the page's lazy requests) and
// says so while it loads or when it failed (the old tabs read a failed load as "none yet"). The sums are the old page's: the variance, the approved and not-approved
// amounts by category, the coverage by status and framework, the blocked and high-impact dependencies. The two bars say their numbers in words; colour is never the
// only cue. Amounts are written $K / $M; a date is a day, never shifted.
import { GitBranch, Plus, Receipt, Shield } from 'lucide-react';
import { Button, EmptyState, RegisterTable, SectionCard, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { EMPTY, NOT_SET, formatCount, formatDate, statusLabel } from '@/lib/format';
import { priority as priorityStatus, statusPill, TONE } from '@/lib/status';
import { budgetStatus, coverageStatus, dependencyStatus } from '@/lib/projectStatus';
import { clampPercent, estimateText, money } from '../_model';
import { TILE, TILE_LABEL, TILE_NUMBER } from '../_ui';
import { AiButton, CARD, CHIP, LoadState, RowMenu, type Handlers } from './_parts';
import type { BudgetData, BudgetItem, Dependency, Mapping } from './_types';

type Query<T> = { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown; data: T | undefined };
const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
const BAR = 'flex h-[12px] overflow-hidden rounded-full bg-ds-border';

function Tile({ label, children, hint }: { label: string; children: string; hint?: string }) {
  return (
    <div className={TILE}>
      <p className={TILE_LABEL}>{label}</p>
      <p className={`mt-[4px] ${TILE_NUMBER}`}>{children}</p>
      {hint && <p className="text-ds-label text-ds-fg-muted">{hint}</p>}
    </div>
  );
}

// ── Budget & financials ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function BudgetTab({ q, h }: { q: Query<BudgetData>; h: Handlers }) {
  const budget = q.data;
  const items: BudgetItem[] = budget?.items ?? [];
  const estimated = budget?.budget_estimated || 0;
  const spent = budget?.total_spent || 0;
  const variance = estimated - spent;
  const pct = estimated ? Math.round((variance / estimated) * 100) : 0;
  const byCategory = items.reduce((acc: Record<string, { approved: number; pending: number }>, item) => {
    if (!acc[item.category]) acc[item.category] = { approved: 0, pending: 0 };
    if (item.status === 'Approved') acc[item.category].approved += item.amount;
    else acc[item.category].pending += item.amount;                  // everything not approved: pending, rejected and cancelled (as before)
    return acc;
  }, {});
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('budget')}>Add item</Button>;
  const menu = (b: BudgetItem) => <RowMenu label={b.description || b.category || 'budget item'} onEdit={() => h.edit('budget', b)} onDelete={() => h.remove('budget', b.id, b.description || b.category || 'this budget item')} />;
  const columns: Array<RegisterColumn<BudgetItem>> = [
    {
      key: 'description', header: 'Item', isRowHeader: true,
      cell: (b) => (
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={b.description || undefined}>{b.description || EMPTY}</p>
          <p className="truncate text-ds-label text-ds-fg-muted">{b.category}</p>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', width: 'w-[104px]', card: 'meta', cell: (b) => <span className="whitespace-nowrap font-[500] tabular-nums text-ds-fg">{money(b.amount)}</span> },
    { key: 'status', header: 'Status', width: 'w-[112px]', card: 'meta', cell: (b) => <StatusPill size="sm" {...statusPill(budgetStatus, b.status)} /> },
    { key: 'approved', header: 'Approved by', priority: 2, width: 'w-[136px]', card: 'meta', cell: (b) => <span className="text-ds-fg-body">{b.approved_by || EMPTY}</span> },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: menu },
  ];
  return (
    <SectionCard id="budget" title="Budget & financials" actions={<><AiButton h={h} ai="estimate-budget">AI estimate</AiButton>{add}</>}>
      <LoadState q={q} noun="budget">
        <div className="flex flex-col gap-[16px]">
          <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
            <Tile label="Budget estimated">{estimateText(estimated)}</Tile>
            <Tile label="Total spent (approved)">{money(spent)}</Tile>
            <Tile label="Variance" hint={estimated > 0 ? (variance >= 0 ? 'Under budget' : 'Over budget') : 'No estimate'}>{estimated > 0 ? `${money(Math.abs(variance))} (${pct}%)` : EMPTY}</Tile>
            <Tile label="Line items">{formatCount(items.length)}</Tile>
          </div>

          {estimated > 0 && items.length > 0 && (
            <div className={CARD}>
              <p className="mb-[12px] text-ds-label font-[600] text-ds-fg-muted">Budget vs actual by category</p>
              <ul className="flex flex-col gap-[12px]">
                {Object.keys(byCategory).map((cat) => {
                  const v = byCategory[cat];
                  return (
                    <li key={cat}>
                      <div className="mb-[4px] flex items-center justify-between gap-[8px] text-ds-body">
                        <span className="font-[500] text-ds-fg">{cat}</span>
                        <span className="tabular-nums text-ds-fg-muted">{money(v.approved + v.pending)} <span className="text-ds-label">({money(v.approved)} approved)</span></span>
                      </div>
                      <div aria-hidden className={BAR}>
                        <div className="h-full bg-ds-primary" style={{ width: `${clampPercent((v.approved / estimated) * 100)}%` }} />
                        <div className="h-full bg-ds-primary-soft" style={{ width: `${clampPercent((v.pending / estimated) * 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <ul className="mt-[12px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-label text-ds-fg-muted">
                <li className="inline-flex items-center gap-[4px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px] bg-ds-primary" />Approved</li>
                <li className="inline-flex items-center gap-[4px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px] bg-ds-primary-soft" />Not approved (pending, rejected or cancelled)</li>
              </ul>
            </div>
          )}

          <RegisterTable<BudgetItem>
            caption="Budget items"
            columns={columns}
            rows={items}
            getRowId={(b) => b.id}
            cardTitle={(b) => <div className="flex items-start justify-between gap-[8px]"><span className="min-w-0 flex-1 break-words font-[600]">{b.description || b.category}</span>{menu(b)}</div>}
            empty={<EmptyState kind="firstUse" bare icon={Receipt} title="No budget items yet" action={add} />}
          />
        </div>
      </LoadState>
    </SectionCard>
  );
}

// ── Compliance mapping ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const COVERAGE_ORDER = ['Verified', 'Implemented', 'In Progress', 'Planned', 'Not Applicable'];

function Coverage({ maps }: { maps: Mapping[] }) {
  const statusCounts = maps.reduce((acc: Record<string, number>, m) => { acc[m.coverage_status] = (acc[m.coverage_status] || 0) + 1; return acc; }, {});
  const frameworkCounts = maps.reduce((acc: Record<string, Record<string, number>>, m) => {
    if (!acc[m.framework_name]) acc[m.framework_name] = {};
    acc[m.framework_name][m.coverage_status] = (acc[m.framework_name][m.coverage_status] || 0) + 1;
    return acc;
  }, {});
  const shown = COVERAGE_ORDER.filter((s) => statusCounts[s]);
  const words = shown.map((s) => `${coverageStatus.label(s)} ${formatCount(statusCounts[s])}`).join(', ');
  const frameworks = Object.keys(frameworkCounts);
  const segments = (counts: Record<string, number>, total: number) => COVERAGE_ORDER.filter((s) => counts[s]).map((s) => <div key={s} className="h-full" style={{ width: `${(counts[s] / total) * 100}%`, background: TONE[coverageStatus.tone(s)].dot }} />);
  return (
    <div className={`${CARD} flex flex-col gap-[16px]`}>
      <div>
        <p className="mb-[8px] text-ds-label font-[600] text-ds-fg-muted">Overall coverage</p>
        <div role="img" aria-label={`Coverage of ${count(maps.length, 'control', 'controls')}: ${words}`} className={BAR}>{segments(statusCounts, maps.length)}</div>
        <ul className="mt-[8px] flex flex-wrap gap-x-[12px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          {shown.map((s) => <li key={s} className="inline-flex items-center gap-[4px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px]" style={{ background: TONE[coverageStatus.tone(s)].dot }} />{coverageStatus.label(s)}: {formatCount(statusCounts[s])}</li>)}
        </ul>
      </div>
      {frameworks.length > 1 && (
        <div>
          <p className="mb-[8px] text-ds-label font-[600] text-ds-fg-muted">By framework</p>
          <ul className="flex flex-col gap-[8px]">
            {frameworks.map((fw) => {
              const total = Object.keys(frameworkCounts[fw]).reduce((a, k) => a + frameworkCounts[fw][k], 0);
              return (
                <li key={fw}>
                  <div className="mb-[4px] flex items-center justify-between gap-[8px] text-ds-body"><span className="font-[500] text-ds-fg">{fw}</span><span className="text-ds-fg-muted">{count(total, 'control', 'controls')}</span></div>
                  <div aria-hidden className={`${BAR} !h-[10px]`}>{segments(frameworkCounts[fw], total)}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ComplianceTab({ q, h }: { q: Query<Mapping[]>; h: Handlers }) {
  const maps = q.data ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('compliance')}>Add mapping</Button>;
  const menu = (m: Mapping) => <RowMenu label={m.control_name || 'mapping'} onEdit={() => h.edit('compliance', m)} onDelete={() => h.remove('compliance', m.id, m.control_name || 'this mapping')} />;
  const columns: Array<RegisterColumn<Mapping>> = [
    {
      key: 'control', header: 'Control', isRowHeader: true,
      cell: (m) => (
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={m.control_name}>{m.control_id != null ? `${m.control_id} — ` : ''}{m.control_name}</p>
          <p className="truncate text-ds-label text-ds-fg-muted" title={m.framework_name}>{m.framework_name}</p>
        </div>
      ),
    },
    { key: 'coverage', header: 'Coverage', width: 'w-[136px]', card: 'meta', cell: (m) => <StatusPill size="sm" {...statusPill(coverageStatus, m.coverage_status)} /> },
    {
      key: 'requirement', header: 'Requirement', priority: 2, card: 'meta',
      cell: (m) => (m.requirement_description || m.notes
        ? <span className="line-clamp-2 text-ds-fg-body [overflow-wrap:anywhere]" title={[m.requirement_description, m.notes].filter(Boolean).join(' — ')}>{[m.requirement_description, m.notes].filter(Boolean).join(' — ')}</span>
        : <span className="text-ds-fg-muted">{EMPTY}</span>),
    },
    { key: 'deliverable', header: 'Deliverable', priority: 3, width: 'w-[160px]', card: 'meta', cell: (m) => <span className="line-clamp-2 text-ds-fg-body [overflow-wrap:anywhere]">{m.deliverable || EMPTY}</span> },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: menu },
  ];
  return (
    <SectionCard id="compliance" title="Compliance mapping" meta={maps.length > 0 ? count(maps.length, 'control', 'controls') : undefined} actions={add}>
      <LoadState q={q} noun="compliance mappings">
        <div className="flex flex-col gap-[16px]">
          {maps.length > 0 && <Coverage maps={maps} />}
          <RegisterTable<Mapping>
            caption="Compliance mappings"
            columns={columns}
            rows={maps}
            getRowId={(m) => m.id}
            cardTitle={(m) => <div className="flex items-start justify-between gap-[8px]"><span className="min-w-0 flex-1 break-words font-[600]">{m.control_id != null ? `${m.control_id} — ` : ''}{m.control_name}</span>{menu(m)}</div>}
            empty={<EmptyState kind="firstUse" bare icon={Shield} title="No compliance mappings yet" action={add} />}
          />
        </div>
      </LoadState>
    </SectionCard>
  );
}

// ── Dependencies ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DIRECTIONS = ['depends_on', 'blocks', 'related_to'];
const nameOf = (d: Dependency) => d.dependent_project_name || d.external_dependency || 'Unnamed';

export function DependenciesTab({ q, h }: { q: Query<Dependency[]>; h: Handlers }) {
  const deps = q.data ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('dependency')}>Add dependency</Button>;
  const menu = (d: Dependency) => <RowMenu label={nameOf(d)} onEdit={() => h.edit('dependency', d)} onDelete={() => h.remove('dependency', d.id, nameOf(d))} />;
  const blocked = deps.filter((d) => d.status === 'Blocked').length;
  const critical = deps.filter((d) => d.impact_if_delayed === 'Critical' || d.impact_if_delayed === 'High').length;
  const byType = deps.reduce((acc: Record<string, number>, d) => { acc[d.dependency_type] = (acc[d.dependency_type] || 0) + 1; return acc; }, {});
  const groups = DIRECTIONS.filter((d) => deps.some((dep) => dep.direction === d));
  const columns: Array<RegisterColumn<Dependency>> = [
    {
      key: 'name', header: 'Dependency', isRowHeader: true,
      cell: (d) => (
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={nameOf(d)}>{nameOf(d)}</p>
          {d.description && <p className="line-clamp-2 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]" title={d.description}>{d.description}</p>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', priority: 2, width: 'w-[96px]', card: 'meta', cell: (d) => <span className="text-ds-fg-body">{statusLabel(d.dependency_type)}</span> },
    { key: 'direction', header: 'Direction', priority: 2, width: 'w-[120px]', card: 'meta', cell: (d) => <span className="text-ds-fg-body">{statusLabel(d.direction)}</span> },
    { key: 'status', header: 'Status', width: 'w-[112px]', card: 'meta', cell: (d) => <StatusPill size="sm" {...statusPill(dependencyStatus, d.status)} /> },
    { key: 'expected', header: 'Expected', priority: 3, width: 'w-[112px]', card: 'meta', cell: (d) => <span className={`whitespace-nowrap tabular-nums ${d.expected_date ? '' : 'text-ds-fg-muted'}`}>{formatDate(d.expected_date, { calendar: true, empty: NOT_SET })}</span> },
    { key: 'impact', header: 'Impact if delayed', priority: 3, width: 'w-[128px]', card: 'meta', cell: (d) => (d.impact_if_delayed ? <StatusPill size="sm" {...statusPill(priorityStatus, d.impact_if_delayed)} /> : <span className="text-ds-fg-muted">{EMPTY}</span>) },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: menu },
  ];
  return (
    <SectionCard id="dependencies" title="Dependencies" meta={deps.length > 0 ? count(deps.length, 'dependency', 'dependencies') : undefined} actions={add}>
      <LoadState q={q} noun="dependencies">
        <div className="flex flex-col gap-[16px]">
          {deps.length > 0 && (
            <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
              <Tile label="Total dependencies">{formatCount(deps.length)}</Tile>
              <Tile label="Blocked" hint={blocked > 0 ? 'Needs attention' : 'None blocked'}>{formatCount(blocked)}</Tile>
              <Tile label="High or critical impact">{formatCount(critical)}</Tile>
              <div className={TILE}>
                <p className={TILE_LABEL}>By type</p>
                <ul className="mt-[8px] flex flex-wrap gap-[6px]">{Object.keys(byType).map((t) => <li key={t} className={CHIP}>{statusLabel(t)}: {formatCount(byType[t])}</li>)}</ul>
              </div>
            </div>
          )}
          {groups.length > 1 && (
            <div className={CARD}>
              <p className="mb-[12px] text-ds-label font-[600] text-ds-fg-muted">Dependency map</p>
              <div className="grid grid-cols-1 gap-[16px] md:grid-cols-3">
                {groups.map((g) => (
                  <div key={g}>
                    <p className="mb-[8px] text-ds-body font-[600] text-ds-fg">{statusLabel(g)}</p>
                    <ul className="flex flex-col gap-[6px]">
                      {deps.filter((d) => d.direction === g).map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-[8px] border-l-2 border-ds-border-strong pl-[8px] text-ds-body text-ds-fg-body">
                          <span className="min-w-0 truncate" title={nameOf(d)}>{nameOf(d)}</span>
                          <StatusPill size="sm" {...statusPill(dependencyStatus, d.status)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
          <RegisterTable<Dependency>
            caption="Dependencies"
            columns={columns}
            rows={deps}
            getRowId={(d) => d.id}
            cardTitle={(d) => <div className="flex items-start justify-between gap-[8px]"><span className="min-w-0 flex-1 break-words font-[600]">{nameOf(d)}</span>{menu(d)}</div>}
            empty={<EmptyState kind="firstUse" bare icon={GitBranch} title="No dependencies tracked yet" action={add} />}
          />
        </div>
      </LoadState>
    </SectionCard>
  );
}
