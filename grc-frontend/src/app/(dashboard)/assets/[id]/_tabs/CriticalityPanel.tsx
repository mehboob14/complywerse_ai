'use client';

/*
 * CriticalityPanel — the asset-detail "Criticality Assessments" tab
 * (activeTab === 'criticality'), restyled VERBATIM into the delivered Overview
 * design language (see ../_overview-design.tsx — warm cards, IBM Plex Mono
 * values, green accent).
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the inline
 * <CriticalityAssessmentsTab assetId={assetId} /> that lived in page.tsx. Because
 * that tab fetched its OWN data, the fetch is kept here untouched — same
 * react-query key (['criticality.byAsset', assetId]), same criticalityApi.byAsset
 * call, same enabled guard. No data is moved, added, or mutated. Every capability
 * is preserved:
 *   - loading + error + empty states,
 *   - the two grouped tables (Information System / Infrastructure Asset),
 *   - the criticality-band and approval-status badges,
 *   - each row's "Open →" deep link,
 *   - the create links (empty-state pair + footer "+ New ISCA / IACA"),
 *   - every GuideMarker (same id + n).
 *
 * The design tokens below mirror _overview-design.tsx one-for-one; no colours or
 * spacing are invented. The 4-step criticality band scale reuses the exact warm
 * ramp already used by the sibling RisksPanel, so the two tabs read as one system.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { criticalityApi, type IscaItem, type IacaItem } from '@/lib/api';
import { GuideMarker } from '@/components/guide';
import { PageLoader } from '@/components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ─── design tokens (mirror _overview-design.tsx exactly) ──────────────── */
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;
const TH = 'text-left sticky top-0 bg-[#f4f7f3] text-[#5c6b62] font-bold text-[10px] tracking-[0.04em] uppercase px-3 py-2 border-b border-[#e4e7e0]';
const TD = 'px-3 py-2 border-b border-[#f2f4ef] align-top';

// Subtle green "create" chip — the delivered soft-green pill, used for the
// footer's low-emphasis "+ New" links.
const CHIP = 'inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap border text-[#0d5c48] bg-[#e7f6ee] border-[#c3ead2] hover:bg-[#d7efe1]';

// Criticality band: worse = warmer/redder. Reuses the sibling RisksPanel's
// 4-step warm ramp verbatim so criticality reads identically across tabs.
const BAND_TONE: Record<string, { fg: string; bg: string; border: string }> = {
  mission_critical: { fg: '#7A2D17', bg: '#F7E4DC', border: '#EED4C9' },
  high:             { fg: '#8A4A0F', bg: '#F6E8D4', border: '#EEDCC0' },
  moderate:         { fg: '#6E5410', bg: '#F4ECD2', border: '#E9DEBC' },
  low:              { fg: '#0E5A46', bg: '#E2EDE8', border: '#CFE0D8' },
};

// Approval status mapped onto the delivered badge palette (green / red / amber /
// grey) — the four tones _overview-design.tsx's badgeCls uses. The label text
// carries the exact stage; colour groups them by disposition.
function approvalCls(status: string) {
  const green = 'text-[#0f7a5c] bg-[#e7f6ee] border-[#c3ead2]';
  const red = 'text-[#b42318] bg-[#fdeceb] border-[#f3cfcb]';
  const amber = 'text-[#a86a12] bg-[#fdf3e3] border-[#f0dcae]';
  const grey = 'text-[#5c6b62] bg-[#f0f2ee] border-[#e0e4dc]';
  const map: Record<string, string> = {
    approved: green,
    rejected: red,
    returned: amber,
    business_owner_review: amber,
    ciso_review: amber,
    submitted: amber,
    draft: grey,
  };
  return 'inline-flex items-center text-[10px] font-bold tracking-[0.03em] uppercase px-2 py-0.5 rounded-md border ' + (map[status] || grey);
}

export default function CriticalityPanel({ assetId }: { assetId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['criticality.byAsset', assetId],
    queryFn: async () => (await criticalityApi.byAsset(assetId)).data,
    enabled: !!assetId,
  });

  if (isLoading) {
    return <PageLoader size="md" className="h-32" />;
  }
  if (error) {
    return (
      <div className="font-['Public_Sans',system-ui,sans-serif] flex items-start gap-2.5 rounded-lg border border-[#f3cfcb] bg-[#fdf1f0] px-3.5 py-2.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#b42318] mt-1.5 shrink-0" />
        <div className="text-[12px] text-[#8a2c22] leading-snug">
          Failed to load criticality assessments.
        </div>
      </div>
    );
  }

  const iscas = data?.isca ?? [];
  const iacas = data?.iaca ?? [];
  const empty = iscas.length === 0 && iacas.length === 0;

  const renderRow = (item: IscaItem | IacaItem, kind: 'isca' | 'iaca') => {
    const level = item.criticality_level || '';
    const band = BAND_TONE[level];
    const status = (item.approval_status || 'draft') as string;
    return (
      <tr key={`${kind}-${item.id}`} className="hover:bg-[#f9faf8]">
        <td className={TD}>
          <div className="text-[13px] font-semibold text-[#1a2b24] break-words leading-snug" style={{ overflowWrap: 'anywhere' }}>
            {item.name}
          </div>
        </td>
        <td className={TD + ' text-right ' + MONO + ' text-[13px] text-[#1a2b24]'}>
          {typeof item.total_score === 'number'
            ? (kind === 'iaca' ? item.total_score.toFixed(2) : item.total_score)
            : <span className="text-[#c6ccc2]">—</span>}
        </td>
        <td className={TD}>
          {level ? (
            <span
              className="inline-flex items-center text-[10px] font-bold tracking-[0.03em] uppercase px-2 py-0.5 rounded-md border capitalize"
              style={band ? { color: band.fg, background: band.bg, borderColor: band.border } : undefined}
            >
              {level.replace('_', ' ')}
            </span>
          ) : (
            <span className="text-[12px] text-[#c6ccc2]">—</span>
          )}
        </td>
        <td className={TD}>
          <span className={approvalCls(status) + ' capitalize'}>
            {status.replace('_', ' ')}
          </span>
        </td>
        <td className={TD + ' text-right'}>
          <Link
            href={`/assets/criticality-assessments?open=${kind}:${item.id}`}
            className="text-[12px] font-semibold text-[#0d5c48] hover:underline whitespace-nowrap"
          >
            Open →
          </Link>
        </td>
      </tr>
    );
  };

  const Section = ({
    title,
    count,
    firstCol,
    scoreLabel,
    approvalGuide,
    rows,
    guide,
  }: {
    title: string;
    count: number;
    firstCol: string;
    scoreLabel: string;
    approvalGuide?: React.ReactNode;
    rows: React.ReactNode;
    guide?: React.ReactNode;
  }) => (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#eceee8]">
        <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#5c6b62] flex items-center gap-1.5">
          {title}
          {guide}
        </div>
        <span className="inline-flex items-center text-[11px] font-bold text-[#aab2a8]">{count}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={TH}>{firstCol}</th>
              <th className={TH + ' text-right'}>{scoreLabel}</th>
              <th className={TH}>Criticality</th>
              <th className={TH}>
                <span className="inline-flex items-center gap-1">Approval {approvalGuide}</span>
              </th>
              <th className={TH + ' text-right'}>Actions</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="font-['Public_Sans',system-ui,sans-serif] text-[#1a2b24] [font-feature-settings:'ss01'] flex flex-col gap-4">
      {empty ? (
        <div className={CARD + ' px-6 py-10 text-center'}>
          <p className="text-[13px] text-[#5c6b62] inline-flex items-center gap-1.5 justify-center">
            No criticality assessments linked to this asset yet.
            <GuideMarker id="asset.critWhy" n={1} />
          </p>
          <p className="mt-1.5 text-[12px] text-[#8a948b]">
            Use the buttons below to create one — the new assessment will be pre-linked to this asset.
          </p>
          <div className="mt-5 inline-flex flex-wrap items-center justify-center gap-2">
            <Link
              href={`/assets/criticality-assessments?create=isca&asset=${assetId}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap border bg-[#0d5c48] text-white border-[#0d5c48]"
            >
              + New Information System assessment
            </Link>
            <Link
              href={`/assets/criticality-assessments?create=iaca&asset=${assetId}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap border bg-white text-[#0d5c48] border-[#c3ead2] hover:bg-[#f9faf8]"
            >
              + New Infrastructure Asset assessment
            </Link>
          </div>
        </div>
      ) : (
        <>
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
