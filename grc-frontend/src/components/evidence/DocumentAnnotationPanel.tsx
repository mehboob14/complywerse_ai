'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  MessageSquarePlus,
  MessageSquare,
  Trash2,
  Check,
  Loader2,
  AlertCircle,
  Quote,
  X,
} from 'lucide-react';

export interface AnnotationRow {
  id: number;
  document_id: number;
  anchor_kind: 'text_range' | 'general';
  anchor_data: { start_offset?: number; end_offset?: number; quoted_text?: string } | Record<string, unknown>;
  comment: string;
  status: 'open' | 'resolved';
  user_id: number;
  user_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingAnchor {
  start_offset: number;
  end_offset: number;
  quoted_text: string;
}

interface Props {
  documentId: number;
  /** When the user selects text in the viewer body and clicks "Add", the
   *  parent passes the captured range here so this panel can save a
   *  text_range annotation rather than a general one. Cleared via
   *  `onAnchorConsumed` once saved or cancelled. */
  pendingAnchor?: PendingAnchor | null;
  onAnchorConsumed?: () => void;
  /** Highlight an annotation in the viewer body when its row is clicked
   *  in the sidebar. Wiring is owned by the parent because only the
   *  viewer knows how to scroll its content. */
  onJumpToAnchor?: (anchor: PendingAnchor) => void;
  /** Optional: get notified when the annotation list changes (e.g. for
   *  the parent viewer to re-render highlight spans). */
  onAnnotationsChanged?: (annotations: AnnotationRow[]) => void;
}

/**
 * Annotation sidebar for the EvidenceViewer when the file being shown is
 * a governance document. Threads aren't supported yet — annotations are
 * flat. Authors can edit/delete their own comments; status toggling
 * (open/resolved) is available to anyone with tenant access.
 */
export default function DocumentAnnotationPanel({
  documentId,
  pendingAnchor,
  onAnchorConsumed,
  onJumpToAnchor,
  onAnnotationsChanged,
}: Props) {
  const qc = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const composeRef = useRef<HTMLTextAreaElement | null>(null);

  // Whenever a fresh range is captured upstream, focus the compose box
  // so the user can type immediately without an extra click.
  useEffect(() => {
    if (pendingAnchor && composeRef.current) {
      composeRef.current.focus();
    }
  }, [pendingAnchor]);

  const { data, isLoading, error } = useQuery<{ annotations: AnnotationRow[]; total: number }>({
    queryKey: ['document-annotations', documentId],
    queryFn: async () => {
      const res = await apiClient.get(`/governance/documents/${documentId}/annotations`);
      return res.data;
    },
  });

  useEffect(() => {
    if (data && onAnnotationsChanged) onAnnotationsChanged(data.annotations);
  }, [data, onAnnotationsChanged]);

  const createMutation = useMutation({
    mutationFn: async (payload: {
      comment: string;
      anchor_kind: 'general' | 'text_range';
      anchor_data?: PendingAnchor;
    }) => {
      const res = await apiClient.post(`/governance/documents/${documentId}/annotations`, payload);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-annotations', documentId] });
      setNewComment('');
      if (onAnchorConsumed) onAnchorConsumed();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (annotationId: number) => {
      await apiClient.delete(`/governance/documents/${documentId}/annotations/${annotationId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-annotations', documentId] }),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: 'open' | 'resolved' }) => {
      await apiClient.put(`/governance/documents/${documentId}/annotations/${id}`, { status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-annotations', documentId] }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = newComment.trim();
    if (!text) return;
    createMutation.mutate({
      comment: text,
      anchor_kind: pendingAnchor ? 'text_range' : 'general',
      anchor_data: pendingAnchor || undefined,
    });
  };

  const items = data?.annotations || [];
  const openCount = items.filter((a) => a.status === 'open').length;
  const resolvedCount = items.length - openCount;

  const grouped = useMemo(() => {
    return {
      textRange: items.filter((a) => a.anchor_kind === 'text_range'),
      general: items.filter((a) => a.anchor_kind === 'general'),
    };
  }, [items]);

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-slate-50/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-slate-500" />
          <p className="text-sm font-semibold text-slate-900">Remarks</p>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">
            {openCount} open · {resolvedCount} resolved
          </span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-slate-500 text-xs">
            <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
            Loading remarks…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3" />
            Couldn&apos;t load remarks.
          </div>
        )}
        {!isLoading && !error && items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
            No remarks yet. Select a passage in the document or type below to add one.
          </div>
        )}

        {grouped.textRange.length > 0 && (
          <div className="space-y-2">
            {grouped.textRange.map((a) => (
              <AnnotationCard
                key={a.id}
                annotation={a}
                onDelete={() => deleteMutation.mutate(a.id)}
                onToggleStatus={() => toggleStatusMutation.mutate({
                  id: a.id,
                  status: a.status === 'open' ? 'resolved' : 'open',
                })}
                onJump={onJumpToAnchor ? () => {
                  const ad = a.anchor_data as PendingAnchor;
                  if (ad && typeof ad.start_offset === 'number') onJumpToAnchor(ad);
                } : undefined}
                deletePending={deleteMutation.isPending}
              />
            ))}
          </div>
        )}

        {grouped.general.length > 0 && (
          <div className="space-y-2">
            {grouped.textRange.length > 0 && (
              <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold px-1 pt-2">
                General comments
              </p>
            )}
            {grouped.general.map((a) => (
              <AnnotationCard
                key={a.id}
                annotation={a}
                onDelete={() => deleteMutation.mutate(a.id)}
                onToggleStatus={() => toggleStatusMutation.mutate({
                  id: a.id,
                  status: a.status === 'open' ? 'resolved' : 'open',
                })}
                deletePending={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Compose */}
      <form onSubmit={handleSubmit} className="border-t border-slate-200 bg-white p-3 space-y-2">
        {pendingAnchor && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            <Quote className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <p className="flex-1 italic line-clamp-2" title={pendingAnchor.quoted_text}>
              &ldquo;{pendingAnchor.quoted_text}&rdquo;
            </p>
            <button
              type="button"
              onClick={onAnchorConsumed}
              className="text-amber-700 hover:text-amber-900 flex-shrink-0"
              title="Cancel anchor (post as general comment instead)"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <textarea
          ref={composeRef}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={3}
          placeholder={pendingAnchor ? 'Comment on the selected passage…' : 'Add a general remark…'}
          className="w-full rounded-md border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-slate-500">
            {pendingAnchor ? 'Anchored to selection' : 'No anchor — posted as a general comment'}
          </p>
          <button
            type="submit"
            disabled={createMutation.isPending || !newComment.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
          >
            {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquarePlus className="h-3 w-3" />}
            Save remark
          </button>
        </div>
      </form>
    </div>
  );
}


function AnnotationCard({
  annotation,
  onDelete,
  onToggleStatus,
  onJump,
  deletePending,
}: {
  annotation: AnnotationRow;
  onDelete: () => void;
  onToggleStatus: () => void;
  onJump?: () => void;
  deletePending: boolean;
}) {
  const date = new Date(annotation.created_at);
  const isResolved = annotation.status === 'resolved';
  const quoted = (annotation.anchor_data as PendingAnchor)?.quoted_text;
  return (
    <div className={`rounded-lg border ${isResolved ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'} p-2.5 text-xs`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-slate-900 truncate">{annotation.user_name || `User #${annotation.user_id}`}</span>
          <span className="text-[10px] text-slate-500 flex-shrink-0">{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onToggleStatus}
            className={`rounded p-0.5 ${isResolved ? 'text-emerald-600 hover:text-emerald-800' : 'text-slate-400 hover:text-slate-700'}`}
            title={isResolved ? 'Reopen' : 'Mark resolved'}
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            onClick={onDelete}
            disabled={deletePending}
            className="rounded p-0.5 text-slate-400 hover:text-rose-600 disabled:opacity-50"
            title="Delete remark"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {quoted && (
        <button
          onClick={onJump}
          className="block w-full text-left rounded border-l-2 border-amber-300 bg-amber-50/60 pl-2 pr-1 py-1 mb-1 text-[11px] text-amber-900 italic hover:bg-amber-100 line-clamp-2"
          title={onJump ? 'Jump to this passage in the document' : quoted}
        >
          &ldquo;{quoted}&rdquo;
        </button>
      )}
      <p className="text-slate-800 whitespace-pre-wrap break-words">{annotation.comment}</p>
      {isResolved && (
        <p className="mt-1 text-[10px] text-emerald-700 font-medium">Resolved</p>
      )}
    </div>
  );
}
