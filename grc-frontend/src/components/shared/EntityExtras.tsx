'use client';

/**
 * Notes, Alerts and History — shared between the asset and vulnerability
 * detail pages. One implementation, two entity types, backed by the
 * /notes, /asset-alerts and /history endpoints.
 *
 * Notes and History are real (backed by tables / the audit log). Alerts are
 * DERIVED live from existing data — there is no alert table to go empty.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Send, Clock, AlertTriangle, ShieldAlert, Radar, Loader2,
} from 'lucide-react';
import { entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

type Entity = 'asset' | 'vulnerability';

/* ─── Notes ───────────────────────────────────────────────────────────── */

export function NotesPanel({ entityType, entityId }: { entityType: Entity; entityId: number }) {
  const qc = useQueryClient();
  const { enabled: guideEnabled } = useGuide();
  const [draft, setDraft] = useState('');
  const key = ['entity-notes', entityType, entityId];

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
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        <MessageSquare size={15} className="text-slate-500" />
        <span className="text-[14.5px] font-semibold text-slate-900">Notes</span>
        <GuideMarker id={`${entityType === 'asset' ? 'asset' : 'vuln'}.notesWhy`} n={1} />
        <GuideMarker id={`${entityType === 'asset' ? 'asset' : 'vuln'}.notesVsHistory`} n={2} />
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{items.length}</span>
      </div>

      <div className="border-b border-slate-100 p-4">
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add a note about this ${entityType === 'asset' ? 'asset' : 'finding'}…`}
          className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-teal-400"
        />
        {guideEnabled && (
          <div className="mt-1.5 flex items-center gap-2">
            <GuideMarker id={`${entityType === 'asset' ? 'asset' : 'vuln'}.notesWho`} n={3} />
            {entityType === 'vulnerability' && <GuideMarker id="vuln.notesFreeform" n={4} />}
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => draft.trim() && add.mutate(draft.trim())}
            disabled={!draft.trim() || add.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-teal-500 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-40"
          >
            {add.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Post note
          </button>
        </div>
      </div>

      <div className="p-4">
        {notes.isLoading ? (
          <p className="text-[13px] text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-slate-400">No notes yet. Be the first to add context.</p>
        ) : (
          <div className="space-y-3">
            {guideEnabled && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                How this reads in an audit
                <GuideMarker id={`${entityType === 'asset' ? 'asset' : 'vuln'}.notesAudit`} n={entityType === 'vulnerability' ? 5 : 4} />
              </div>
            )}
            {items.map((n) => (
              <div key={n.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="mb-1 flex items-center gap-2 text-[12px]">
                  <span className="font-semibold text-slate-700">{n.author_name || 'Unknown'}</span>
                  <span className="text-slate-400">{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</span>
                </div>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">{n.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Alerts (derived) ────────────────────────────────────────────────── */

const ALERT_TONE: Record<string, string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function AlertsPanel({ assetId, canEdit }: { assetId: number; canEdit?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['asset-alerts', assetId],
    queryFn: async () => (await entityExtrasApi.assetAlerts(assetId)).data,
  });
  const act = useMutation({
    mutationFn: ({ kind, action }: { kind: string; action: 'acknowledge' | 'resolve' }) =>
      entityExtrasApi.setAlertState(assetId, kind, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-alerts', assetId] }),
  });
  const items = q.data ?? [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        <ShieldAlert size={15} className="text-slate-500" />
        <span className="text-[14.5px] font-semibold text-slate-900">Alerts</span>
        <span className="ml-auto text-[11.5px] text-slate-400">derived from live data · no alert is stored</span>
      </div>
      <div className="p-4">
        {q.isLoading ? (
          <p className="text-[13px] text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
            <Radar size={14} /> Nothing needs attention on this asset right now.
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((a: any, i: number) => {
              const resolved = a.status === 'resolved';
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 ${ALERT_TONE[a.severity] ?? ALERT_TONE.info} ${resolved ? 'opacity-60' : ''}`}
                >
                  <AlertTriangle size={15} className="mt-0.5 flex-none" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold">{a.title}</span>
                      {a.status && a.status !== 'open' && (
                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider">
                          {a.status}
                        </span>
                      )}
                    </div>
                    <div className="text-[12.5px] opacity-90">{a.detail}</div>
                    {(a.acknowledged_by_name || a.resolved_by_name) && (
                      <div className="mt-1 text-[11.5px] opacity-70">
                        {resolved
                          ? `Resolved by ${a.resolved_by_name}`
                          : `Acknowledged by ${a.acknowledged_by_name}`}
                      </div>
                    )}
                  </div>
                  {canEdit && !resolved && (
                    <div className="flex flex-none gap-1.5">
                      {a.status !== 'acknowledged' && (
                        <button
                          onClick={() => act.mutate({ kind: a.kind, action: 'acknowledge' })}
                          disabled={act.isPending}
                          className="rounded-md bg-white/80 px-2.5 py-1 text-[11.5px] font-semibold hover:bg-white disabled:opacity-50"
                        >
                          Ack
                        </button>
                      )}
                      <button
                        onClick={() => act.mutate({ kind: a.kind, action: 'resolve' })}
                        disabled={act.isPending}
                        className="rounded-md bg-white/80 px-2.5 py-1 text-[11.5px] font-semibold hover:bg-white disabled:opacity-50"
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── History ─────────────────────────────────────────────────────────── */

export function HistoryPanel({ entityType, entityId }: { entityType: Entity; entityId: number }) {
  const { enabled: guideEnabled } = useGuide();
  const q = useQuery({
    queryKey: ['entity-history', entityType, entityId],
    queryFn: async () => (await entityExtrasApi.history(entityType, entityId)).data,
  });
  const items = q.data ?? [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        <Clock size={15} className="text-slate-500" />
        <span className="text-[14.5px] font-semibold text-slate-900">Change history</span>
        <GuideMarker id={`${entityType === 'asset' ? 'asset' : 'vuln'}.historyWhy`} n={1} />
        <GuideMarker id={`${entityType === 'asset' ? 'asset' : 'vuln'}.historyActor`} n={2} />
        <GuideMarker id={`${entityType === 'asset' ? 'asset' : 'vuln'}.historyImmutable`} n={3} />
      </div>
      <div className="p-4">
        {q.isLoading ? (
          <p className="text-[13px] text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-slate-400">
            No changes recorded yet. Edits made from here on are journalled and will appear in this timeline.
          </p>
        ) : (
          <div className="space-y-0">
            {guideEnabled && (
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                How an auditor reads this tab
                <GuideMarker id={entityType === 'asset' ? 'asset.historyAudit' : 'vuln.historyAuditor'} n={4} />
              </div>
            )}
            {items.map((h, i) => (
              <div key={h.id} className="flex gap-3 py-2.5" style={{ borderBottom: i < items.length - 1 ? '1px solid var(--as-divider, #eee)' : 'none' }}>
                <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-slate-300" />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-slate-800">{h.detail || h.action}</div>
                  <div className="text-[12px] text-slate-400">
                    {h.actor_name || 'system'} · {h.action}{h.created_at ? ` · ${new Date(h.created_at).toLocaleString()}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
