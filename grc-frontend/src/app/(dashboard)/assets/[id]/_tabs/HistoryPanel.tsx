'use client';

/*
 * HistoryPanel — asset-detail "History" tab, restyled to match the approved
 * mint-teal record-page mock (asset-record-mocks/History.html, main content
 * column only — the rail/tab-bar are owned by the page shell).
 *
 * PRESENTATION ONLY. Same props (`entityType` / `entityId`), same react-query
 * key (`['entity-history', entityType, entityId]`), same `entityExtrasApi.history`
 * call, same loading / empty / list states, same GuideMarkers. Nothing is
 * fetched, mutated, or shaped differently — only the render changes.
 *
 * The mock renders per-entry before→after diff chips and a fixed category
 * filter (Criticality / Scans / Ownership / …). The real history row
 * (`HistoryOut` in entity_extras_router.py) only carries `action` + a
 * free-text `detail` built from whatever changed — there's no old-value field
 * to diff against and no category field, so:
 *   - entries show `detail || action` (unchanged from the prior panel) instead
 *     of a fabricated before/after pair.
 *   - the filter row is keyed on the real `action` string instead of an
 *     invented taxonomy, with a deterministic colour per action so entries of
 *     the same kind still read as one colour, same as the mock's dots.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

type Entity = 'asset' | 'vulnerability';

/* ── mint-teal tokens, matching asset-record-mocks/History.html ── */
const BORDER = '#E8ECEE';
const BORDER2 = '#F0F3F5';
const INK = '#0F1F2B';
const SEC = '#3A4653';
const MUTED = '#8A95A1';
const FAINT = '#AEB8C2';
const AC_STRONG = '#12A085';
const CARD = "bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-hidden";

// Deterministic dot colour per real `action` string — gives the mock's
// colour-coded-by-kind read without inventing a category field.
const DOT_COLORS = ['#6A54C9', '#2E63A8', '#9A6410', '#B23A3A', '#1F7A54', AC_STRONG];
function colorFor(action: string) {
  let h = 0;
  for (let i = 0; i < action.length; i++) h = (h * 31 + action.charCodeAt(i)) >>> 0;
  return DOT_COLORS[h % DOT_COLORS.length];
}
function prettify(action: string) {
  const t = action.replace(/[_.-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : action;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayKey(iso?: string) {
  if (!iso) return 'undated';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(iso?: string) {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const now = new Date();
  if (sameDay(d, now)) return `Today · ${dateStr}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (sameDay(d, yest)) return `Yesterday · ${dateStr}`;
  return dateStr;
}

function chipStyle(active: boolean): CSSProperties {
  return active
    ? { background: INK, color: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: INK }
    : { background: '#fff', color: SEC, borderWidth: 1, borderStyle: 'solid', borderColor: BORDER };
}

function FilterChip({
  active, color, label, count, onClick,
}: { active: boolean; color: string; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-[25px] pl-2 pr-[10px] rounded-full text-[10.5px] font-semibold whitespace-nowrap"
      style={chipStyle(active)}
    >
      <span className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: color, boxShadow: active ? '0 0 0 2px rgba(255,255,255,.35)' : undefined }} />
      {label} <span style={{ color: active ? '#C9D0D6' : FAINT, fontWeight: 600 }}>{count}</span>
    </button>
  );
}

export default function HistoryPanel({ entityType, entityId }: { entityType: Entity; entityId: number }) {
  const { enabled: guideEnabled } = useGuide();
  const [filter, setFilter] = useState('all');

  // Data layer — identical to the shared EntityExtras HistoryPanel.
  const q = useQuery({
    queryKey: ['entity-history', entityType, entityId],
    queryFn: async () => (await entityExtrasApi.history(entityType, entityId)).data,
  });
  const items = q.data ?? [];

  const g = entityType === 'asset' ? 'asset' : 'vuln';

  const filters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of items) counts.set(h.action, (counts.get(h.action) ?? 0) + 1);
    return Array.from(counts.entries()).map(([action, count]) => ({ action, count, color: colorFor(action) }));
  }, [items]);

  const groups = useMemo(() => {
    const filtered = filter === 'all' ? items : items.filter((h) => h.action === filter);
    const out: { key: string; label: string; entries: typeof items }[] = [];
    for (const h of filtered) {
      const key = dayKey(h.created_at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.entries.push(h);
      else out.push({ key, label: dayLabel(h.created_at), entries: [h] });
    }
    return out;
  }, [items, filter]);

  return (
    <div className="font-['Poppins',system-ui,sans-serif] text-[13.5px]" style={{ color: INK }}>
      <div className={CARD}>

        {/* HEADER */}
        <div className="flex items-start justify-between gap-3 px-4 py-[13px]" style={{ borderBottom: `1px solid ${BORDER2}` }}>
          <div className="flex gap-2.5 min-w-0">
            <Clock className="h-[18px] w-[18px] shrink-0 mt-px" strokeWidth={1.8} style={{ color: AC_STRONG }} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold flex items-center gap-1.5">
                Change history
                <GuideMarker id={`${g}.historyWhy`} n={1} />
                <GuideMarker id={`${g}.historyActor`} n={2} />
                <GuideMarker id={`${g}.historyImmutable`} n={3} />
              </div>
              <div className="text-[11px] mt-[2px]" style={{ color: MUTED }}>
                Immutable, journalled record of every change made to this {entityType === 'asset' ? 'asset' : 'finding'}.
              </div>
            </div>
          </div>
          <span className="shrink-0 text-[10.5px] font-bold rounded-full px-[10px] py-[3px]" style={{ background: BORDER2, color: SEC }}>
            {items.length} {items.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {/* BODY */}
        {q.isLoading ? (
          <p className="px-4 py-[18px] text-[13px]" style={{ color: FAINT }}>Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px]" style={{ color: FAINT }}>
            No changes recorded yet. Edits made from here on are journalled and will appear in this timeline.
          </p>
        ) : (
          <>
            {guideEnabled && (
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] px-4 pt-3" style={{ color: FAINT }}>
                How an auditor reads this tab
                <GuideMarker id={entityType === 'asset' ? 'asset.historyAudit' : 'vuln.historyAuditor'} n={4} />
              </div>
            )}

            {/* FILTER ROW — keyed on the real `action` field, not a fabricated category */}
            <div className="flex items-center gap-[6px] flex-wrap px-4 py-[11px]" style={{ borderBottom: `1px solid ${BORDER2}` }}>
              <span className="text-[10px] font-bold uppercase tracking-[0.05em] mr-0.5" style={{ color: FAINT }}>Filter</span>
              <FilterChip active={filter === 'all'} color={INK} label="All" count={items.length} onClick={() => setFilter('all')} />
              {filters.map((f) => (
                <FilterChip
                  key={f.action}
                  active={filter === f.action}
                  color={f.color}
                  label={prettify(f.action)}
                  count={f.count}
                  onClick={() => setFilter(f.action)}
                />
              ))}
            </div>

            {/* TIMELINE */}
            <div className="relative px-[18px] pt-[14px] pb-1">
              <div className="absolute left-[23px] top-[6px] bottom-[14px] w-[2px]" style={{ background: BORDER }} />
              {groups.map((day) => (
                <div key={day.key} className="relative mt-1 first:mt-0">
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] py-2 pl-[25px]" style={{ color: FAINT }}>
                    {day.label}
                  </div>
                  {day.entries.map((h) => {
                    const time = h.created_at
                      ? new Date(h.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                      : null;
                    return (
                      <div key={h.id} className="relative flex gap-[11px] py-[9px] pl-[3px]">
                        <span
                          className="w-[9px] h-[9px] rounded-full flex-none mt-1 relative z-[1]"
                          style={{ background: colorFor(h.action), border: '2px solid #fff', boxShadow: `0 0 0 1px ${BORDER}` }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-[10px]">
                            <span className="text-[12.5px] font-semibold break-words" style={{ color: INK, overflowWrap: 'anywhere' }}>
                              {h.detail || h.action}
                            </span>
                            {time && <time className="text-[10.5px] whitespace-nowrap flex-none" style={{ color: FAINT }}>{time}</time>}
                          </div>
                          <div className="text-[11px] mt-[5px]" style={{ color: MUTED }}>
                            by <b className="font-semibold" style={{ color: SEC }}>{h.actor_name || 'system'}</b>
                            {' · '}
                            <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-[10.5px]">{h.action}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
