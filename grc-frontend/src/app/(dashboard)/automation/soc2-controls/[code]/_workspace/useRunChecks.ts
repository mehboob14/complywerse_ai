'use client';

// Run the automated tests of a control (all of them from the header, one source's from its row) and SAY how it went: how many ran, how many could not and why, one report either way. The old
// button swallowed every error, so a missing connection or a missing right looked like a test that was running for ever. The tenant's AWS connection is read when a run starts, not when the page opens.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNotify } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { automationApi } from '@/lib/api';
import { awsConnectionId, refreshControl } from './workspaceData';
import { runReport, type RunOutcome } from './workspaceModel';

export interface RunnableCheck { id: number | null; title: string | null }

export function useRunChecks(): { run: (checks: readonly RunnableCheck[]) => Promise<void>; running: boolean } {
  const notify = useNotify();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const run = async (checks: readonly RunnableCheck[]) => {
    const runnable = checks.filter((c): c is { id: number; title: string | null } => c.id != null);
    if (running) return;
    setRunning(true);
    const outcomes: RunOutcome[] = [];
    try {
      const connection = runnable.length ? await awsConnectionId().catch(() => null) : null;
      for (const c of runnable) {
        const title = c.title ?? 'A test';
        try {
          const res = await automationApi.runCheck(c.id, connection ?? undefined);
          outcomes.push({ title, ok: true, status: (res.data as { run?: { status?: string } })?.run?.status });
        } catch (e) {
          outcomes.push({ title, ok: false, error: errorMessage(e) });
        }
      }
    } finally {
      setRunning(false);
    }
    await refreshControl(qc);
    const report = runReport(outcomes);
    if (report.tone === 'success') notify.success(report.message, { title: report.title });
    else if (report.tone === 'warning') notify.warning(report.message, { title: report.title });
    else notify.error(report.message, { title: report.title, retry: () => { void run(checks); } });
  };

  return { run, running };
}
