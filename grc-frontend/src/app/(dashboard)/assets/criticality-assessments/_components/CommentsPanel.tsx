'use client';

// CommentsPanel — threaded comments on a single criticality assessment.
// Reply is one level deep, matching Issue comments. Posting a comment
// automatically writes an activity row server-side, so the audit log
// surfaces every collaboration touchpoint.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Loader2, Reply } from 'lucide-react';
import {
  criticalityApi,
  type CriticalityCommentRow,
  type CriticalityKind,
} from '@/lib/api';

export function CommentsPanel({
  kind, itemId,
}: { kind: CriticalityKind; itemId: number }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [replyParent, setReplyParent] = useState<number | null>(null);

  const listQ = useQuery<CriticalityCommentRow[]>({
    queryKey: ['criticality.comments', kind, itemId],
    queryFn: async () => (await criticalityApi.comments.list(kind, itemId)).data,
  });

  const addM = useMutation({
    mutationFn: (params: { body: string; parentId: number | null }) =>
      criticalityApi.comments.add(kind, itemId, params.body, params.parentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.comments', kind, itemId] });
      qc.invalidateQueries({ queryKey: ['criticality.activity', kind, itemId] });
      setBody('');
      setReplyParent(null);
    },
  });

  // Build a 1-level tree: top-level comments + a children map for replies.
  const { roots, replies } = useMemo(() => {
    const list = listQ.data ?? [];
    const replyMap = new Map<number, CriticalityCommentRow[]>();
    const top: CriticalityCommentRow[] = [];
    for (const c of list) {
      if (c.parent_id) {
        const arr = replyMap.get(c.parent_id) ?? [];
        arr.push(c);
        replyMap.set(c.parent_id, arr);
      } else {
        top.push(c);
      }
    }
    return { roots: top, replies: replyMap };
  }, [listQ.data]);

  const handlePost = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    addM.mutate({ body: trimmed, parentId: replyParent });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-start gap-2">
          <MessageSquare className="mt-1.5 h-4 w-4 text-slate-400" />
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={replyParent ? 'Replying to comment…' : 'Add a comment…'}
            className="block w-full text-sm rounded-md border border-slate-300 bg-white text-slate-900 px-2 py-1.5 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          {replyParent ? (
            <button
              type="button"
              onClick={() => setReplyParent(null)}
              className="text-[11px] text-slate-500 hover:text-slate-700"
            >
              Cancel reply
            </button>
          ) : <span />}
          <button
            type="button"
            disabled={addM.isPending || !body.trim()}
            onClick={handlePost}
            className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {addM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Post
          </button>
        </div>
      </div>

      {listQ.isLoading ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
      ) : roots.length === 0 ? (
        <p className="text-center text-xs text-slate-500">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {roots.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <CommentRow c={c} onReply={() => setReplyParent(c.id)} />
              {(replies.get(c.id) ?? []).length > 0 && (
                <ul className="ml-5 mt-2 space-y-2 border-l border-slate-100 pl-3">
                  {(replies.get(c.id) ?? []).map((r) => (
                    <li key={r.id}>
                      <CommentRow c={r} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentRow({
  c, onReply,
}: { c: CriticalityCommentRow; onReply?: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-800">
          {c.user?.display_name || 'Unknown'}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">
            {new Date(c.created_at).toLocaleString()}
          </span>
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="inline-flex items-center gap-0.5 text-[10px] text-primary-700 hover:underline"
            >
              <Reply className="h-3 w-3" />
              Reply
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>
    </div>
  );
}
