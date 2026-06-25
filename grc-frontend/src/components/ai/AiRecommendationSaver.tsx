'use client';

// ─────────────────────────────────────────────────────────────────────────────
// AiRecommendationSaver — a drop-in "review & save" bar for any AI output.
//
// Once a user reviews an AI result and clicks Save, it persists per-tenant via
// the generic /ai-recommendations store, so every other user with access to the
// same module/entity sees the saved output. Reusable across modules: pass a
// stable (module, recommendationType, entityType?, entityId?) key + the current
// `output`. On mount it loads any saved record and calls onLoaded so the host
// can render it.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { aiRecommendationsApi } from '@/lib/api';
import { Sparkles, Save, Check, Loader2, X } from 'lucide-react';

export interface SavedAiRec {
  id: number;
  output: Record<string, unknown>;
  title?: string | null;
  summary?: string | null;
  model?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export default function AiRecommendationSaver({
  module, recommendationType, entityType, entityId, title, summary, output, model,
  onLoaded, className,
}: {
  module: string;
  recommendationType: string;
  entityType?: string;
  entityId?: string | number;
  title?: string;
  summary?: string;
  output?: Record<string, unknown> | null;
  model?: string;
  onLoaded?: (saved: SavedAiRec | null) => void;
  className?: string;
}) {
  const [saved, setSaved] = useState<SavedAiRec | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await aiRecommendationsApi.list({
        module, recommendation_type: recommendationType, entity_type: entityType, entity_id: entityId,
      });
      const items = ((res.data as { items?: SavedAiRec[] })?.items || []);
      const found = items[0] || null;
      setSaved(found);
      onLoaded?.(found);
    } catch {
      setSaved(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, recommendationType, entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!output) return;
    setSaving(true);
    try {
      const res = await aiRecommendationsApi.save({
        module, recommendation_type: recommendationType, entity_type: entityType, entity_id: entityId,
        title, summary, output, model,
      });
      setSaved(res.data as SavedAiRec);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!saved) return;
    setSaving(true);
    try {
      await aiRecommendationsApi.remove(saved.id);
      setSaved(null);
      onLoaded?.(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${saved ? 'border-emerald-200 bg-emerald-50' : 'border-indigo-200 bg-indigo-50/50'} ${className || ''}`}>
      {saved ? (
        <>
          <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
          <span className="text-emerald-800">Saved for the team{saved.updated_at ? ` · ${String(saved.updated_at).slice(0, 10)}` : ''}</span>
          <span className="ml-auto flex items-center gap-1">
            {output && (
              <button type="button" onClick={save} disabled={saving}
                className="inline-flex items-center gap-1 rounded border border-emerald-300 px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Update
              </button>
            )}
            <button type="button" onClick={clear} disabled={saving}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600">
              <X className="h-3 w-3" /> Clear
            </button>
          </span>
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600" />
          <span className="text-indigo-800">Review this AI output, then save it so your team sees it.</span>
          <button type="button" onClick={save} disabled={saving || !output}
            className="ml-auto inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save for team
          </button>
        </>
      )}
    </div>
  );
}
