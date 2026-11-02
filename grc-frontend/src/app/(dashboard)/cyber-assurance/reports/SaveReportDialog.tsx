'use client';

// Save the Report Builder's current definition as a named, reusable report
// (POST /reporting/reports). When the builder was opened from one of your own saved
// reports you can update it in place or save a copy; otherwise it is always a new one.
import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookmarkPlus, Loader2 } from 'lucide-react';
import { AnimatedModal, useToast } from '@/cyber-assurance/components/ui';
import {
  apiErrorMessage,
  newReportSlug,
  savedReportsApi,
  type BuilderSnapshot,
  type SavedReport,
} from '@/cyber-assurance/lib/reportingExtrasApi';
import { ACCENT, btnGhost, btnPrimary, fieldLabel, inputCls, labelize } from './shared';

export default function SaveReportDialog({
  open,
  onClose,
  snapshot,
  loadedFrom,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: BuilderSnapshot | null;
  /** The saved report the builder was last opened from, if any. */
  loadedFrom: SavedReport | null;
  onSaved: (report: SavedReport) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(loadedFrom?.name ?? (snapshot ? `${labelize(snapshot.dataset)} report` : ''));
    setShared(loadedFrom?.is_shared ?? false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canUpdate = !!loadedFrom?.is_mine;

  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      if (!snapshot) throw new Error('Nothing to save yet.');
      const slug = !asNew && canUpdate && loadedFrom ? loadedFrom.slug : newReportSlug(name);
      const res = await savedReportsApi.save({
        slug,
        name: name.trim(),
        dataset: snapshot.dataset,
        spec: {
          columns: snapshot.columns,
          filters: snapshot.filters,
          logic: snapshot.logic,
          format: snapshot.format,
        },
        is_shared: shared,
      });
      return res.data;
    },
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ['saved-reports'] });
      qc.invalidateQueries({ queryKey: ['report-schedules'] }); // schedules follow saved reports live
      toast({ title: 'Report saved', message: `"${report.name}" is now in Saved reports.`, type: 'success' });
      onSaved(report);
      onClose();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the report.')),
  });

  const nameOk = name.trim().length > 0;
  const summary = snapshot
    ? `${labelize(snapshot.dataset)} · ${snapshot.columns.length} column${snapshot.columns.length === 1 ? '' : 's'} · ` +
      `${snapshot.filters.length} filter${snapshot.filters.length === 1 ? '' : 's'}`
    : '';

  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      size="md"
      title="Save report"
      subtitle={summary}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          {canUpdate && (
            <button onClick={() => save.mutate(true)} disabled={!nameOk || save.isPending} className={btnGhost}>
              Save as new
            </button>
          )}
          <button
            onClick={() => save.mutate(false)}
            disabled={!nameOk || save.isPending}
            className={btnPrimary}
            style={{ background: ACCENT }}
          >
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <BookmarkPlus size={15} />}
            {canUpdate ? 'Update report' : 'Save report'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <label className="block">
          <span className={fieldLabel}>Name</span>
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameOk && !save.isPending) save.mutate(false);
            }}
            placeholder="e.g. Critical vulnerabilities, weekly review"
            className={inputCls}
          />
        </label>

        <label className="flex items-start gap-2.5 text-sm text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
          />
          <span>
            Share with everyone in this workspace
            <span className="block text-[13px] text-[var(--color-muted)]">
              Others can open, download and schedule it; only you can change or delete it.
            </span>
          </span>
        </label>

        {canUpdate && (
          <p className="text-[13px] text-[var(--color-muted)]">
            Opened from <span className="font-medium text-[var(--color-text)]">{loadedFrom?.name}</span>. Update
            overwrites it (schedules that follow it pick up the change); Save as new keeps both.
          </p>
        )}

        {error && (
          <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-danger)]">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}
