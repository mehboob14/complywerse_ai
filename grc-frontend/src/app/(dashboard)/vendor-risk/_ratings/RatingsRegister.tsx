'use client';

// Monitoring > Security ratings: every supplier's websites and domains as the internet sees them, on the same explorer as the Alerts register (components/records/RegisterFrame). Grade, score,
// how it moved, what is open and what is waived come from the server as they always have; this file only filters and orders them and says the scale. A row opens a drawer with the facts and
// a link to the supplier's own Outside-in tab (where it is scanned, its domains set and its findings waived). A failed read says so with a Retry; it never reads as "no supplier matches".
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, Gauge } from 'lucide-react';
import { Button, ChipList, EmptyState, Fact, FactList, Menu, Notice, SectionCard, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { vendorSecurityApi } from '@/lib/api';
import { EMPTY, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { outsideInGrade } from '@/lib/statuses/vendorMonitoring';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { RATINGS_SCHEMA, gradeOf, headLine, providersOf, ratingsDef, riskCounts, scaleWords, type RatingRow, type RatingsAnswer } from './ratingsModel';

const MUTED = 'text-ds-fg-muted';
const LINK = linkClasses({ tone: 'text', size: 'label' });
const hrefOf = (r: RatingRow) => `/vendor-risk/vendors/${r.vendor.id}?tab=outside-in`;

const Grade = ({ r }: { r: RatingRow }) => <StatusPill size="sm" {...statusPill(outsideInGrade, gradeOf(r))} />;
const Change = ({ n }: { n: number | null }) => (n ? <span className={`whitespace-nowrap tabular-nums text-ds-body ${n > 0 ? 'text-ds-success' : 'text-ds-danger'}`}>{n > 0 ? '▲' : '▼'} {Math.abs(n)}<span className="sr-only">{n > 0 ? ' higher' : ' lower'} than the last scan</span></span> : <span className={`text-ds-body ${MUTED}`}>{EMPTY}</span>);

export interface RatingsHeadProps { meta?: string; info?: string; actions: React.ReactNode }

export default function RatingsRegister({ label, head }: { label: string; head: (h: RatingsHeadProps) => React.ReactNode }) {
  const router = useRouter();
  const def = useMemo(() => ratingsDef(), []);
  const q = useQuery({
    queryKey: ['tprm-outside-in-portfolio'],
    queryFn: async () => (await vendorSecurityApi.portfolio()).data as RatingsAnswer,
    ...TPRM_QUERY_OPTS,
  });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const providers = useMemo(() => providersOf(rows), [rows]);

  const columns: RecordColumn<RatingRow>[] = [
    {
      key: 'vendor', header: 'Supplier', sortKey: 'vendor',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.vendor.name}>{row.record.vendor.name}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>
            {[row.record.vendor.tier ? `${vendorTier.label(row.record.vendor.tier)} tier` : null, row.record.domains[0] ?? 'No domain on record'].filter(Boolean).join(' · ')}
          </span>
        </div>
      ),
    },
    { key: 'grade', header: 'Grade', sortKey: 'grade', fit: { px: 136 }, cell: (row) => <Grade r={row.record} /> },
    { key: 'score', header: 'Score', sortKey: 'score', fit: { px: 80 }, cell: (row) => <span className={`tabular-nums text-ds-body ${row.record.score === null ? MUTED : 'text-ds-fg'}`}>{row.record.score ?? EMPTY}</span> },
    { key: 'change', header: 'Change', sortKey: 'change', fit: { px: 92, dropRank: 3 }, cell: (row) => <Change n={row.record.change} /> },
    { key: 'scanned', header: 'Scanned', sortKey: 'scanned', firstDir: 'desc', fit: { px: 116, dropRank: 2 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{row.record.scanned_at ? formatDate(row.record.scanned_at) : 'Never'}</span> },
    { key: 'serious', header: 'High or critical', sortKey: 'serious', firstDir: 'desc', fit: { px: 120, dropRank: 4 }, cell: (row) => <span className={`tabular-nums text-ds-body ${row.record.serious ? 'font-[600] text-ds-danger' : MUTED}`}>{row.record.score === null ? EMPTY : row.record.serious}</span> },
    { key: 'waived', header: 'Waived', sortKey: 'waived', firstDir: 'desc', fit: { px: 88, dropRank: 1 }, cell: (row) => <span className={`tabular-nums text-ds-body ${MUTED}`}>{row.record.waived || EMPTY}</span> },
    ...providers.map((p): RecordColumn<RatingRow> => ({
      key: `p:${p}`, header: p, fit: { px: 108, dropRank: 1 },
      cell: (row) => <span title={riskCounts(row.record.ratings[p]?.risks) ?? undefined} className={`tabular-nums text-ds-body ${row.record.ratings[p] ? 'text-ds-fg' : MUTED}`}>{row.record.ratings[p]?.score ?? EMPTY}</span>,
    })),
  ];
  const card = (row: RecordRow<RatingRow>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{row.record.vendor.name}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><Grade r={row.record} /><span className={`tabular-nums text-ds-body ${MUTED}`}>{row.record.score === null ? 'Not scored' : `Score ${row.record.score}`}</span></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{[row.record.vendor.tier ? `${vendorTier.label(row.record.vendor.tier)} tier` : null, row.record.scanned_at ? `Scanned ${formatDate(row.record.scanned_at)}` : 'Never scanned'].filter(Boolean).join(' · ')}</span>
    </div>
  );

  const a = q.data;
  const actions = <Button href="/vendor-risk/reports" leftIcon={<FileText aria-hidden />}>Quarterly report</Button>;
  const menu = (r: RatingRow) => {
    const items: MenuItem[] = [{ key: 'open', label: 'Open the supplier', icon: ArrowUpRight, onSelect: () => router.push(hrefOf(r)) }];
    return <Menu iconOnly label={`Actions for ${r.vendor.name.slice(0, 60)}`} items={items} />;
  };

  return (
    <RegisterFrame
      def={def}
      schema={RATINGS_SCHEMA}
      label={label}
      rows={rows}
      loading={q.isLoading}
      error={q.isError && !q.data ? q.error : undefined}
      refreshError={q.isError && q.data ? q.error : undefined}
      onRetry={() => { void q.refetch(); }}
      head={() => head({ meta: a ? headLine(a, rows.length) : undefined, info: a ? scaleWords(a) : undefined, actions })}
      notices={a ? (
        <>
          {!a.enabled && (
            <Notice tone="warning" title="Scheduled scans are off" action={<Link href="/vendor-risk/settings" className={LINK}>Open Settings</Link>}>
              Until they are turned on, a supplier is scanned only when someone asks from its Outside-in tab.
            </Notice>
          )}
          {!a.shodan && (
            <Notice tone="info" title="Exposed services and known vulnerabilities are not included" action={<Link href="/admin/connectors" className={LINK}>Open Connectors</Link>}>
              Add a Shodan key to include them. UpGuard, SecurityScorecard and BitSight connect there too.
            </Notice>
          )}
          {a.expiring_waivers.length > 0 && (
            <SectionCard id="waivers" title="Waivers ending in the next 30 days" info="Each finding counts against the supplier again when its waiver ends." meta={`${a.expiring_waivers.length} ${a.expiring_waivers.length === 1 ? 'waiver' : 'waivers'}`}>
              <ul className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
                {a.expiring_waivers.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-baseline justify-between gap-[8px] py-[8px] text-ds-body text-ds-fg">
                    <span><Link href={`/vendor-risk/vendors/${w.vendor.id}?tab=outside-in`} className={LINK}>{w.vendor.name}</Link><span className={MUTED}> · {w.finding_key}{w.host ? ` on ${w.host}` : ''}</span></span>
                    <span className={`text-ds-label ${MUTED}`}>ends {formatDate(w.expires_on, { calendar: true })} ({w.days_left} {w.days_left === 1 ? 'day' : 'days'})</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </>
      ) : undefined}
      columns={columns}
      card={card}
      boardCard={() => null}
      boardLabel={(r) => r.vendor.name}
      rowActions={menu}
      rowLabel={(r) => `Select ${r.vendor.name.slice(0, 60)}`}
      searchLabel="Search suppliers by name or domain"
      noAccess={{ title: "You don't have access to security ratings", reason: errorMessage(q.error) }}
      emptyFirst={(
        <EmptyState
          bare kind="firstUse" icon={Gauge} title="No supplier to rate yet"
          description="Suppliers appear here with a grade once they have a domain and a scan. Add suppliers in the register, then scan them from their Outside-in tab."
          action={<Link href="/vendor-risk/vendors" className={LINK}>Open the vendor register</Link>}
        />
      )}
      detail={(open, nav) => (
        <RecordDetail
          id={open?.vendor.id ?? null}
          nav={nav}
          title={<span dir="auto" className="line-clamp-3 break-words">{open?.vendor.name}</span>}
          subtitle={open ? `${outsideInGrade.label(gradeOf(open))}${open.score === null ? '' : `, score ${open.score}`}` : undefined}
          footer={open ? <Button href={hrefOf(open)} variant="primary" rightIcon={<ArrowUpRight aria-hidden />}>Open the supplier</Button> : undefined}
        >
          {open && <RatingFacts r={open} />}
        </RecordDetail>
      )}
    />
  );
}

function RatingFacts({ r }: { r: RatingRow }) {
  const providers = Object.entries(r.ratings);
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Grade r={r} />
        {r.vendor.tier && <StatusPill size="sm" {...statusPill(vendorTier, r.vendor.tier)} />}
      </div>
      <FactList min={150}>
        <Fact label="Score">{r.score === null ? null : <span className="tabular-nums">{r.score} out of 100</span>}</Fact>
        <Fact label="Since the last scan">{r.change ? <Change n={r.change} /> : null}</Fact>
        <Fact label="Last scanned" empty="Never">{r.scanned_at ? formatDate(r.scanned_at) : null}</Fact>
        <Fact label="High or critical findings">{r.score === null ? null : <span className="tabular-nums">{r.serious}</span>}</Fact>
        <Fact label="Waived findings">{r.waived ? <span className="tabular-nums">{r.waived}</span> : null}</Fact>
        <Fact label="Domains" empty="None on record"><ChipList items={r.domains} label="domains" shown={3} /></Fact>
      </FactList>
      {providers.length > 0 && (
        <section className="flex flex-col gap-[6px]">
          <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Provider ratings</h3>
          <ul className="m-0 flex list-none flex-col gap-[4px] p-0 text-ds-body text-ds-fg">
            {providers.map(([name, p]) => (
              <li key={name}><span className="font-[600]">{name}</span> {p.score}{riskCounts(p.risks) ? <span className={MUTED}> · {riskCounts(p.risks)}</span> : null}<span className={`text-ds-label ${MUTED}`}> · {formatDate(p.at)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
