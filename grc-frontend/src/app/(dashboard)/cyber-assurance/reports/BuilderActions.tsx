'use client';

// "Save" and "Schedule" controls rendered in the Report Builder's footer (via its
// `footerExtras` slot). They act on whatever the builder holds right now.
import React from 'react';
import { BookmarkPlus, CalendarClock } from 'lucide-react';
import type { BuilderSnapshot } from '@/cyber-assurance/lib/reportingExtrasApi';
import { btnGhost } from './shared';

export default function BuilderActions({
  snapshot,
  onSave,
  onSchedule,
}: {
  snapshot: BuilderSnapshot | null;
  onSave: () => void;
  onSchedule: () => void;
}) {
  const disabled = !snapshot || snapshot.columns.length === 0;
  return (
    <>
      <button
        onClick={onSave}
        disabled={disabled}
        className={btnGhost}
        title="Save this definition so you can reopen, share or schedule it"
      >
        <BookmarkPlus size={15} /> Save
      </button>
      <button
        onClick={onSchedule}
        disabled={disabled}
        className={btnGhost}
        title="Email this report to people on a schedule"
      >
        <CalendarClock size={15} /> Schedule
      </button>
    </>
  );
}
