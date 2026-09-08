'use client';

/*
 * CriticalityPanel — the asset-detail "Criticality" tab (activeTab === 'criticality'),
 * restyled to match the approved Criticality mock's mint-teal card system.
 *
 * Data model note: the mock shows a Confidentiality/Integrity/Availability triad.
 * This product scores criticality via ISCA (Information System) and IACA
 * (Infrastructure Asset) assessments instead — there is no real C/I/A rating to
 * show, so nothing is fabricated:
 *   - "Overall Criticality" → real aggregate (highest band + most recent date +
 *     approved/total ratio) across every linked ISCA + IACA assessment.
 *   - "3 CIA cards" → one real row per kind (Information System / Infrastructure
 *     Asset) instead of Confidentiality/Integrity/Availability.
 *   - "Business Impact Summary" (data classification / users affected / downtime)
 *     has no matching field on IscaItem/IacaItem, so it is omitted rather than
 *     invented.
 *   - "Assessment History" → the existing per-item table, now also carrying the
 *     real assessor + assessment-date columns it already had data for.
 *
 * Everything else is unchanged: same react-query key (['criticality.byAsset',
 * assetId]), same criticalityApi.byAsset call + enabled guard, same loading/
 * error/empty states, same two grouped tables, same band + approval semantics,
 * same "Open →" deep links, same create links, same GuideMarkers (id + n).
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { criticalityApi, type IscaItem, type IacaItem } from '@/lib/api';
import { GuideMarker } from '@/components/guide';
import { PageLoader } from '@/components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ─── design tokens (mint-teal — mirrors the approved Criticality mock) ──── */
const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,.04)]';
const CH = 'flex items-center gap-[9px] px-4 py-[13px] border-b border-[#F0F3F5]';
const TH = 'text-left text-[9.5px] uppercase tracking-[.04em] font-semibold text-[#8A95A1] px-4 py-[9px] border-b border-[#F0F3F5] whitespace-nowrap';
const TD = 'px-4 py-[10px] text-[11.5px] text-[#3A4653] border-b border-[#F0F3F5] align-middle';
const BTN_SECONDARY = 'inline-flex items-center justify-center h-[32px] px-3.5 rounded-[9px] text-[12px] font-semibold bg-white border border-[#E8ECEE] text-[#3A4653] hover:border-[#CFD6DC] whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap border text-[#12A085] bg-[#E4F8F2] border-[#BFEBE0] hover:bg-[#D8F2E9]';
const RING_C = 327; // circumference of the r=52 ring, matches the mock exactly

// Real 4-tier criticality band (mission_critical > high > moderate > low). The
// mock's 1-5 CIA scale has no equivalent field here, so bands fill a 4-segment
// track instead of inventing a 5th tier.
const BAND_ORDER = ['low', 'moderate', 'high', 'mission_critical'] as const;
const BAND_LABEL: Record<string, string> = {
  mission_critical: 'Mission critical', high: 'High', moderate: 'Moderate', low: 'Low',
};
const BAND_TONE: Record<string, { fg: string; bg: string }> = {
  mission_critical: { fg: '#B23A3A', bg: '#FBEAEA' }, // red
  high: { fg: '#9A6410', bg: '#FBF2DF' },             // amber
  moderate: { fg: '#2E63A8', bg: '#E9F1FB' },         // blue
  low: { fg: '#1F7A54', bg: '#E7F5EE' },              // green
};
const NEUTRAL_TONE = { fg: '#8A95A1', bg: '#F1F4F6' };

function bandTier(level?: string | null) {
  const i = BAND_ORDER.indexOf((level ?? '') as (typeof BAND_ORDER)[number]);
  return i < 0 ? 0 : i + 1; // 0 = unrated, else 1..4
}

// Approval status → same badge palette as before, recoloured to the mock's tokens.
const APPROVAL_TONE: Record<string, { fg: string; bg: string }> = {
  approved: { fg: '#1F7A54', bg: '#E7F5EE' },
  rejected: { fg: '#B23A3A', bg: '#FBEAEA' },
  returned: { fg: '#9A6410', bg: '#FBF2DF' },
  business_owner_review: { fg: '#9A6410', bg: '#FBF2DF' },
  ciso_review: { fg: '#9A6410', bg: '#FBF2DF' },
  submitted: { fg: '#9A6410', bg: '#FBF2DF' },
  draft: { fg: '#6B7787', bg: '#F1F4F6' },
};

function Pill({ tone, children }: { tone: { fg: string; bg: string }; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[10px] font-bold uppercase tracking-[.02em] whitespace-nowrap"
      style={{ color: tone.fg, background: tone.bg }}
    >
      {children}
    </span>
  );
}

function fmtDate(s?: string | null) {
  return s ? String(s).slice(0, 10) : null;
}

export default function CriticalityPanel({ assetId }: { assetId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['criticality.byAsset', assetId],
    queryFn: async () => (await criticalityApi.byAsset(assetId)).data,
    enabled: !!assetId,
  });

  const iscas = data?.isca ?? [];
  const iacas = data?.iaca ?? [];
  const empty = iscas.length === 0 && iacas.length === 0;

  // Real aggregate for the "Overall Criticality" card: highest band, most
  // recent assessment date, and approved/total ratio across every linked
  // ISCA + IACA assessment. Called unconditionally (hooks rule) even while
  // loading/erroring, on whatever data is available (empty arrays are cheap).
  const overall = useMemo(() => {
    const all: (IscaItem | IacaItem)[] = [...iscas, ...iacas];
    let topLevel: string | null = null;
    let topTier = 0;
    let lastDate: string | null = null;
    let approvedCount = 0;
    for (const item of all) {
      const tier = bandTier(item.criticality_level);
      if (tier > topTier) { topTier = tier; topLevel = item.criticality_level ?? null; }
      const d = item.date_of_assessment ?? item.updated_at ?? item.created_at ?? null;
      if (d && (!lastDate || d > lastDate)) lastDate = d;
      if (item.approval_status === 'approved') approvedCount += 1;
    }
    return {
      count: all.length,
      topLevel,
      lastDate: fmtDate(lastDate),
      approvedFraction: all.length ? approvedCount / all.length : 0,
    };
  }, [iscas, iacas]);

  if (isLoading) {
    return <PageLoader size="md" className="h-32" />;
  }
  if (error) {
    return (
      <div className="font-['Poppins',system-ui,sans-serif] flex items-start gap-2.5 rounded-lg border border-[#F3CFCB] bg-[#FBEAEA] px-3.5 py-2.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#B23A3A] mt-1.5 shrink-0" />
        <div className="text-[12px] text-[#8A2C22] leading-snug">
          Failed to load criticality assessments.
        </div>
      </div>
    );
  }

  const renderRow = (item: IscaItem | IacaItem, kind: 'isca' | 'iaca') => {
    const level = item.criticality_level || '';
    const tone = BAND_TONE[level] ?? NEUTRAL_TONE;
    const status = (item.approval_status || 'draft') as string;
    const statusTone = APPROVAL_TONE[status] ?? NEUTRAL_TONE;
    const assessor = item.assessor_user_name || item.assessor_name || null;
    return (
      <tr key={`${kind}-${item.id}`} className="hover:bg-[#F9FAFA]">
        <td className={TD}>
          <div className="text-[12px] font-semibold text-[#0F1F2B] break-words leading-snug" style={{ overflowWrap: 'anywhere' }}>
            {item.name}
          </div>
        </td>
        <td className={TD}>{assessor ?? <span className="text-[#AEB8C2]">—</span>}</td>
        <td className={TD + ' [font-variant-numeric:tabular-nums]'}>
          {fmtDate(item.date_of_assessment) ?? <span className="text-[#AEB8C2]">—</span>}
        </td>
        <td className={TD + ' text-right [font-variant-numeric:tabular-nums]'}>
          {typeof item.total_score === 'number'
            ? (kind === 'iaca' ? item.total_score.toFixed(2) : item.total_score)
            : <span className="text-[#AEB8C2]">—</span>}
        </td>
        <td className={TD}>
          {level ? <Pill tone={tone}>{BAND_LABEL[level] ?? level.replace('_', ' ')}</Pill> : <span className="text-[12px] text-[#AEB8C2]">—</span>}
        </td>
        <td className={TD}>
          <Pill tone={statusTone}>{status.replace('_', ' ')}</Pill>
        </td>
        <td className={TD + ' text-right'}>
          <Link
            href={`/assets/criticality-assessments?open=${kind}:${item.id}`}
            className="text-[12px] font-semibold text-[#12A085] hover:underline whitespace-nowrap"
          >
            Open →
          </Link>
        </td>
      </tr>
    );
  };

  const Section = ({
    title, count, firstCol, scoreLabel, approvalGuide, rows, guide,
  }: {
    title: string; count: number; firstCol: string; scoreLabel: string;
    approvalGuide?: React.ReactNode; rows: React.ReactNode; guide?: React.ReactNode;
  }) => (
    <div className={CARD}>
      <div className={CH}>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <h4 className="text-[12.5px] font-semibold text-[#0F1F2B]">{title}</h4>
          {guide}
        </div>
        <span className="text-[11px] text-[#8A95A1] font-medium whitespace-nowrap">
          {count} assessment{count === 1 ? '' : 's'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>{firstCol}</th>
              <th className={TH}>Assessor</th>
              <th className={TH}>Date</th>
              <th className={TH + ' text-right'}>{scoreLabel}</th>
              <th className={TH}>Criticality</th>
              <th className={TH}><span className="inline-flex items-center gap-1">Approval {approvalGuide}</span></th>
              <th className={TH + ' text-right'}>Actions</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );

  const kindSummaries: { label: string; items: (IscaItem | IacaItem)[] }[] = [
    { label: 'Information System', items: iscas },
    { label: 'Infrastructure Asset', items: iacas },
  ];

  return (
    <div className="font-['Poppins',system-ui,sans-serif] text-[13.5px] text-[#0F1F2B] flex flex-col gap-3.5">
      {empty ? (
        <div className={CARD + ' px-6 py-10 text-center'}>
          <p className="text-[13px] text-[#3A4653] inline-flex items-center gap-1.5 justify-center">
            No criticality assessments linked to this asset yet.
            <GuideMarker id="asset.critWhy" n={1} />
          </p>
          <p className="mt-1.5 text-[12px] text-[#8A95A1]">
            Use the buttons below to create one — the new assessment will be pre-linked to this asset.
          </p>
          <div className="mt-5 inline-flex flex-wrap items-center justify-center gap-2">
            <Link
              href={`/assets/criticality-assessments?create=isca&asset=${assetId}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-[9px] whitespace-nowrap border bg-[#17B898] text-[#06342B] border-[#17B898] hover:bg-[#12A085]"
            >
              + New Information System assessment
            </Link>
            <Link
              href={`/assets/criticality-assessments?create=iaca&asset=${assetId}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-[9px] whitespace-nowrap border bg-white text-[#12A085] border-[#BFEBE0] hover:bg-[#F9FAFA]"
            >
              + New Infrastructure Asset assessment
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Overall criticality — real aggregate across every linked assessment */}
          <div className={CARD}>
            <div className="flex items-center justify-between gap-3 px-[18px] py-3.5 border-b border-[#F0F3F5] flex-wrap">
              <div>
                <h3 className="text-[14px] font-semibold text-[#0F1F2B]">Overall Criticality</h3>
                <span className="block text-[11px] text-[#8A95A1] mt-0.5">
                  {overall.count} linked assessment{overall.count === 1 ? '' : 's'}
                  {overall.lastDate ? ` · last assessed ${overall.lastDate}` : ''}
                </span>
              </div>
              <Link href="/assets/criticality-assessments" className={BTN_SECONDARY}>
                Manage assessments
              </Link>
            </div>
            <div className="grid gap-[22px] items-center px-5 py-[18px]" style={{ gridTemplateColumns: '150px minmax(0,1fr)' }}>
              <div className="text-center">
                <div className="relative mx-auto" style={{ width: 104, height: 104 }}>
                  <svg viewBox="0 0 120 120" width={104} height={104} style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="60" cy="60" r="52" fill="none" stroke="#EEF1F4" strokeWidth={12} />
                    <circle
                      cx="60" cy="60" r="52" fill="none"
                      stroke={overall.topLevel ? BAND_TONE[overall.topLevel].fg : NEUTRAL_TONE.fg}
                      strokeWidth={12} strokeLinecap="round"
                      strokeDasharray={RING_C}
                      strokeDashoffset={RING_C * (1 - overall.approvedFraction)}
                    />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center">
                    <div>
                      <b
                        className="[font-variant-numeric:tabular-nums] text-[22px] font-semibold block text-center"
                        style={{ color: overall.topLevel ? BAND_TONE[overall.topLevel].fg : NEUTRAL_TONE.fg }}
                      >
                        {overall.count}
                      </b>
                      <small className="block text-[9px] text-[#AEB8C2]">assessment{overall.count === 1 ? '' : 's'}</small>
                    </div>
                  </div>
                </div>
                <div className="mt-2.5">
                  <Pill tone={overall.topLevel ? BAND_TONE[overall.topLevel] : NEUTRAL_TONE}>
                    {overall.topLevel ? BAND_LABEL[overall.topLevel] : 'Not yet rated'}
                  </Pill>
                </div>
              </div>
              <div className="grid gap-[11px]">
                {kindSummaries.map(({ label, items }) => {
                  const kindTop = items.reduce<string | null>(
                    (acc, i) => (bandTier(i.criticality_level) > bandTier(acc) ? (i.criticality_level ?? null) : acc),
                    null,
                  );
                  const tone = kindTop ? BAND_TONE[kindTop] : NEUTRAL_TONE;
                  const tier = bandTier(kindTop);
                  return (
                    <div key={label} className="grid items-center gap-3 text-[12px]" style={{ gridTemplateColumns: '140px minmax(0,1fr) 24px' }}>
                      <span className="text-[#3A4653]">{label}</span>
                      <span className="h-[9px] rounded-full bg-[#EEF1F4] overflow-hidden block">
                        <i className="block h-full rounded-full" style={{ width: `${(tier / 4) * 100}%`, background: tone.fg }} />
                      </span>
                      <b className="[font-variant-numeric:tabular-nums] text-right">{items.length}</b>
                    </div>
                  );
                })}
                <div className="text-[10.5px] text-[#AEB8C2] mt-0.5">
                  Overall band takes the highest of every linked ISCA / IACA assessment (high-water mark).
                </div>
              </div>
            </div>
          </div>

          {iscas.length > 0 && (
            <Section
              title="Information System Criticality Assessments"
              count={iscas.length}
              firstCol="Information System"
              scoreLabel="Total"
              approvalGuide={<GuideMarker id="asset.critApprover" n={3} />}
              guide={<GuideMarker id="asset.critIsca" n={1} />}
              rows={iscas.map((i) => renderRow(i, 'isca'))}
            />
          )}

          {iacas.length > 0 && (
            <Section
              title="Infrastructure Asset Criticality Assessments"
              count={iacas.length}
              firstCol="Infrastructure Asset"
              scoreLabel="Score"
              guide={<GuideMarker id="asset.critIaca" n={2} />}
              rows={iacas.map((i) => renderRow(i, 'iaca'))}
            />
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/assets/criticality-assessments?create=isca&asset=${assetId}`} className={CHIP}>
              + New ISCA
            </Link>
            <Link href={`/assets/criticality-assessments?create=iaca&asset=${assetId}`} className={CHIP}>
              + New IACA
            </Link>
            <GuideMarker id="asset.critVsDerived" n={4} />
            <GuideMarker id="asset.critWhy" n={5} />
          </div>
        </>
      )}
    </div>
  );
}
