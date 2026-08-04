'use client';

/**
 * NotesPanel — asset-detail "Notes" tab, restyled to the AssetOverview design
 * handoff (warm cream + IBM Plex, --as-* tokens, scoped under .asset-suite).
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the shared
 * <NotesPanel> from '@/components/shared/EntityExtras'. It keeps the exact same
 * data contract — the ['entity-notes', entityType, entityId] react-query key,
 * entityExtrasApi.listNotes / addNote, useGuide + GuideMarkers — and every
 * capability (compose + post, count badge, loading / empty states, audit guide
 * row, per-note author + timestamp + body). Nothing here fetches or mutates
 * differently; only the markup and styling changed.
 *
 * Parent usage (unchanged from today):
 *   {activeTab === 'notes' && <NotesPanel entityType="asset" entityId={assetId} />}
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Loader2 } from 'lucide-react';
import { entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

type Entity = 'asset' | 'vulnerability';

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

  const labelCap = { fontSize: 10.5, fontWeight: 600 as const, letterSpacing: 0.6, textTransform: 'uppercase' as const, color: 'var(--as-muted)' };

  return (
    <div className="as-card" style={{ overflow: 'hidden' }}>
      {/* Header — icon + title + guide markers + count badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '15px 22px', borderBottom: '1px solid var(--as-divider)' }}>
        <MessageSquare className="h-[18px] w-[18px]" style={{ color: 'var(--as-green)' }} strokeWidth={2} />
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--as-ink)' }}>Notes</span>
        <GuideMarker id={`${gPrefix}.notesWhy`} n={1} />
        <GuideMarker id={`${gPrefix}.notesVsHistory`} n={2} />
        <span
          className="as-mono"
          style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--as-muted)', background: 'var(--as-track)', borderRadius: 99, padding: '2px 9px' }}
        >
          {items.length}
        </span>
      </div>

      {/* Compose — draft textarea + post action */}
      <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--as-divider)' }}>
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add a note about this ${entityType === 'asset' ? 'asset' : 'finding'}…`}
          className="as-input"
          style={{ width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.5 }}
        />
        {guideEnabled && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <GuideMarker id={`${gPrefix}.notesWho`} n={3} />
            {entityType === 'vulnerability' && <GuideMarker id="vuln.notesFreeform" n={4} />}
          </div>
        )}
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => draft.trim() && add.mutate(draft.trim())}
            disabled={!draft.trim() || add.isPending}
            className="as-btn as-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: !draft.trim() || add.isPending ? 0.4 : 1 }}
          >
            {add.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Post note
          </button>
        </div>
      </div>

      {/* List — loading / empty / notes */}
      <div style={{ padding: '16px 22px' }}>
        {notes.isLoading ? (
          <p style={{ fontSize: 13, color: 'var(--as-disabled)' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: 'var(--as-disabled)' }}>
            No notes yet. Be the first to add context.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {guideEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...labelCap, letterSpacing: 0.4 }}>
                How this reads in an audit
                <GuideMarker id={`${gPrefix}.notesAudit`} n={entityType === 'vulnerability' ? 5 : 4} />
              </div>
            )}
            {items.map((n) => (
              <div
                key={n.id}
                style={{ border: '1px solid var(--as-border)', background: 'var(--as-subtle)', borderRadius: 'var(--as-r-inner)', padding: '12px 14px', minWidth: 0 }}
              >
                <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--as-primary)' }}>{n.author_name || 'Unknown'}</span>
                  <span style={{ fontSize: 12, color: 'var(--as-faint)' }}>{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13.5, lineHeight: 1.55, color: 'var(--as-secondary)' }}>{n.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
