'use client';

/*
 * HistoryPanel — asset-detail "History" tab, restyled to the delivered design
 * language (see ../_overview-design.tsx, rendered by the Overview tab).
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the shared HistoryPanel
 * that lived in @/components/shared/EntityExtras. The data layer is preserved
 * VERBATIM: same props (`entityType` / `entityId`), the same react-query key
 * (`['entity-history', entityType, entityId]`), the same `entityExtrasApi.history`
 * call, the same loading / empty / list states, and every GuideMarker. Nothing is
 * fetched, mutated, or shaped differently here — only the styling changes so this
 * tab reads as one system with Overview.
 *
 * The Overview design's primitives (Cell / CARD / tokens) are NOT exported from
 * _overview-design.tsx, so the load-bearing tokens are replicated locally, 1:1
 * with that file's values — the same approach the sibling LifecyclePanel uses.
 */

import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

type Entity = 'asset' | 'vulnerability';

/* ── design tokens, replicated verbatim from _overview-design.tsx ── */
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;

export default function HistoryPanel({ entityType, entityId }: { entityType: Entity; entityId: number }) {
  const { enabled: guideEnabled } = useGuide();

  // Data layer — identical to the shared EntityExtras HistoryPanel.
  const q = useQuery({
    queryKey: ['entity-history', entityType, entityId],
    queryFn: async () => (await entityExtrasApi.history(entityType, entityId)).data,
  });
  const items = q.data ?? [];

  const g = entityType === 'asset' ? 'asset' : 'vuln';

  return (
    <div className="font-['Public_Sans',system-ui,sans-serif] text-[#1a2b24] [font-feature-settings:'ss01']">
      <div className={CARD}>

        {/* HEADER — mirrors Overview's card header (icon + title + subtitle + right pill) */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#eceee8]">
          <div className="flex gap-2.5 min-w-0">
            <Clock className="h-[18px] w-[18px] shrink-0 mt-px" strokeWidth={2} style={{ color: '#0d5c48' }} />
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold tracking-[-0.01em] flex items-center gap-1.5">
                Change history
                <GuideMarker id={`${g}.historyWhy`} n={1} />
                <GuideMarker id={`${g}.historyActor`} n={2} />
                <GuideMarker id={`${g}.historyImmutable`} n={3} />
              </div>
              <div className="text-[11.5px] text-[#aab2a8] mt-px">
                An immutable, journalled record of every change made to this {entityType === 'asset' ? 'asset' : 'finding'}.
              </div>
            </div>
          </div>
          <span className="shrink-0 text-[11px] font-bold tracking-[0.04em] uppercase px-2.5 py-[3px] rounded-full border bg-[#eef1ec] text-[#5c6b62] border-[#e0e4dc]">
            {items.length} {items.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {/* BODY */}
        <div className="px-5 py-[18px]">
          {q.isLoading ? (
            <p className="text-[13px] text-[#aab2a8]">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[#aab2a8]">
              No changes recorded yet. Edits made from here on are journalled and will appear in this timeline.
            </p>
          ) : (
            <div className="flex flex-col">
              {guideEnabled && (
                <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8a948b]">
                  How an auditor reads this tab
                  <GuideMarker id={entityType === 'asset' ? 'asset.historyAudit' : 'vuln.historyAuditor'} n={4} />
                </div>
              )}
              {items.map((h, i) => (
                <div
                  key={h.id}
                  className="flex gap-3 py-3"
                  style={{ borderBottom: i < items.length - 1 ? '1px solid #f2f4ef' : 'none' }}
                >
                  <span className="mt-[7px] h-2 w-2 flex-none rounded-full bg-[#c6ccc2]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[#1a2b24] leading-snug break-words" style={{ overflowWrap: 'anywhere' }}>
                      {h.detail || h.action}
                    </div>
                    <div className="text-[12px] text-[#8a948b] mt-0.5">
                      <span className="font-semibold text-[#5c6b62]">{h.actor_name || 'system'}</span>
                      {' · '}
                      <span className={MONO + ' text-[11px]'}>{h.action}</span>
                      {h.created_at ? ` · ${new Date(h.created_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
