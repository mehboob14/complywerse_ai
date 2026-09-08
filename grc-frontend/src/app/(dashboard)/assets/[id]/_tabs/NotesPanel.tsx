'use client';

/**
 * NotesPanel — asset-detail "Notes" tab, restyled to the mint-teal record-page
 * mock (asset-record-mocks/Notes.html: composer card + note feed).
 *
 * PRESENTATION ONLY. Drop-in replacement for the shared <NotesPanel> from
 * '@/components/shared/EntityExtras'. Same data contract — the
 * ['entity-notes', entityType, entityId] react-query key, entityExtrasApi.listNotes /
 * addNote, useGuide + GuideMarkers — same capabilities (compose + post, count
 * badge, loading / empty states, audit guide row, per-note author + timestamp +
 * body). The API only ever returns { id, body, author_name?, created_at } — no
 * tags and no edit/delete endpoint exist server-side, so this view does not
 * invent either; only markup and styling changed.
 *
 * Parent usage (unchanged from today):
 *   {activeTab === 'notes' && <NotesPanel entityType="asset" entityId={assetId} />}
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Loader2, User } from 'lucide-react';
import { entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

type Entity = 'asset' | 'vulnerability';

const AC = '#17B898';
const AC_STRONG = '#12A085';
const AC_SOFT = '#E4F8F2';
const INK = '#0F1F2B';
const SEC = '#3A4653';
const MUTED = '#8A95A1';
const FAINT = '#AEB8C2';
const BORDER = '#E8ECEE';
const BORDER2 = '#F0F3F5';

// Deterministic avatar color per author name (mirrors the mock's per-person palette).
const AVATAR_COLORS = [
  { bg: AC_SOFT, fg: AC_STRONG },
  { bg: '#E9F1FB', fg: '#2E63A8' },
  { bg: '#EEEBFA', fg: '#6A54C9' },
];
function avatarColor(name: string) {
  const sum = name.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotesPanel({ entityType, entityId }: { entityType: Entity; entityId: number }) {
  const qc = useQueryClient();
  const { enabled: guideEnabled } = useGuide();
  const [draft, setDraft] = useState('');
  const key = ['entity-notes', entityType, entityId];
  const gPrefix = entityType === 'asset' ? 'asset' : 'vuln';

  const notes = useQuery({
    queryKey: key,
    queryFn: async () => (await entityExtrasApi.listNotes(entityType, entityId)).data,
  });
  const add = useMutation({
    mutationFn: (body: string) => entityExtrasApi.addNote(entityType, entityId, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setDraft(''); },
  });

  const items = notes.data ?? [];

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 15, boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden', fontFamily: "'Poppins',system-ui,sans-serif", fontSize: 13.5, color: INK }}>
      {/* Header — icon + title + guide markers + count badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 16px', borderBottom: `1px solid ${BORDER2}` }}>
        <MessageSquare className="h-4 w-4 flex-shrink-0" style={{ color: AC_STRONG }} strokeWidth={1.8} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Notes</span>
        <GuideMarker id={`${gPrefix}.notesWhy`} n={1} />
        <GuideMarker id={`${gPrefix}.notesVsHistory`} n={2} />
        <span
          className="tabular-nums"
          style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: MUTED, background: BORDER2, borderRadius: 999, padding: '2px 9px' }}
        >
          {items.length}
        </span>
      </div>

      {/* Composer — avatar + draft textarea + post action */}
      <div style={{ padding: '15px 16px', borderBottom: `1px solid ${BORDER2}`, display: 'flex', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none', background: AC_SOFT, color: AC_STRONG }}>
          <User className="h-[15px] w-[15px]" strokeWidth={2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add a note about this ${entityType === 'asset' ? 'asset' : 'finding'}…`}
            className="border border-[#E8ECEE] bg-[#F7F9FA] focus:outline-none focus:border-[#17B898] focus:bg-white transition-colors"
            style={{ width: '100%', minHeight: 58, resize: 'vertical', borderRadius: 10, padding: '9px 11px', fontSize: 12.5, fontFamily: 'inherit', lineHeight: 1.5, color: INK }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
            {guideEnabled && (
              <>
                <GuideMarker id={`${gPrefix}.notesWho`} n={3} />
                {entityType === 'vulnerability' && <GuideMarker id="vuln.notesFreeform" n={4} />}
              </>
            )}
            <button
              onClick={() => draft.trim() && add.mutate(draft.trim())}
              disabled={!draft.trim() || add.isPending}
              className="bg-[#17B898] hover:enabled:bg-[#12A085] transition-colors"
              style={{ marginLeft: 'auto', height: 32, padding: '0 15px', borderRadius: 9, border: `1px solid ${AC}`, color: '#06342B', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: !draft.trim() || add.isPending ? 0.5 : 1, cursor: !draft.trim() || add.isPending ? 'default' : 'pointer' }}
            >
              {add.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Post
            </button>
          </div>
        </div>
      </div>

      {/* Feed — loading / empty / notes */}
      <div style={{ padding: '14px 16px 16px' }}>
        {notes.isLoading ? (
          <p style={{ fontSize: 13, color: FAINT }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: FAINT }}>
            No notes yet. Be the first to add context.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {guideEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: MUTED }}>
                How this reads in an audit
                <GuideMarker id={`${gPrefix}.notesAudit`} n={entityType === 'vulnerability' ? 5 : 4} />
              </div>
            )}
            {items.map((n) => {
              const author = n.author_name || 'Unknown';
              const color = avatarColor(author);
              return (
                <div
                  key={n.id}
                  className="border border-[#F0F3F5] bg-[#FBFCFC] hover:bg-[#F7F9FA] hover:border-[#E8ECEE] transition-colors"
                  style={{ display: 'flex', gap: 10, padding: '12px 13px', borderRadius: 11, minWidth: 0 }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none', fontSize: 10.5, fontWeight: 600, background: color.bg, color: color.fg }}>
                    {initials(author)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{author}</span>
                      <span style={{ fontSize: 11, color: FAINT }}>{n.created_at ? relativeTime(n.created_at) : ''}</span>
                    </div>
                    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12.5, lineHeight: 1.55, color: SEC, marginTop: 5 }}>{n.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
