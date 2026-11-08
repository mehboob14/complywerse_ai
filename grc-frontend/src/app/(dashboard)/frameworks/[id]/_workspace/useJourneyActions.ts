'use client';

// The journey's own actions, each one a reported mutation (a confirmation when the server has answered, a failure that stays with a Retry): the
// report download, the target date, a snapshot of today's compliance, and the AI jobs (critical-clause analysis, the certification timeline).
import apiClient, { certificationsApi } from '@/lib/api';
import { useReportedMutation } from '@/components/ui/ds';

export function useGenerateReport(journeyId: number) {
  return useReportedMutation({
    mutationFn: async () => (await apiClient.get(`/certifications/${journeyId}/report`, { responseType: 'blob' })).data as Blob,
    success: 'Report downloaded',
    failure: "Couldn't create the report",
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `framework-${journeyId}-report.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    },
  });
}

/** The target date is a DAY: the value of the date field ("2026-11-12") is sent as typed, never turned into a UTC moment (which moved the day). */
export function useUpdateTargetDate(journeyId: number, onSaved?: () => void) {
  return useReportedMutation({
    mutationFn: async (day: string) => certificationsApi.update(journeyId, { target_date: day }),
    success: 'Target date saved',
    failure: "Couldn't save the target date",
    invalidate: [['certification', journeyId]],
    onSuccess: () => onSaved?.(),
  });
}

/** Captures today's compliance as a permanent record, and the same moment becomes a point of the trend (the charts only read it). */
export function useCaptureSnapshot(journeyId: number) {
  return useReportedMutation({
    mutationFn: async () => {
      const year = new Date().getFullYear();
      return apiClient.post(`/certifications/${journeyId}/snapshots`, { year, label: `${year} Assessment` });
    },
    success: { title: 'Snapshot captured', message: 'It is kept as a permanent record and adds a point to the trend.' },
    failure: "Couldn't capture the snapshot",
    retryable: false,
    invalidate: [['compliance-snapshots', journeyId], ['journey-charts', journeyId]],
  });
}

/** The AI scan that flags red-flag clauses: a button, never a side effect of opening the page. */
export function useAnalyzeCritical(journeyId: number) {
  return useReportedMutation({
    mutationFn: async () => certificationsApi.analyzeCriticalControls(journeyId),
    success: 'Critical-clause analysis finished',
    failure: "The AI analysis didn't finish",
    // the list carries `is_critical` per row, so its badges appear too
    invalidate: [['critical-controls', journeyId], ['certification-controls', journeyId]],
  });
}

/** The certification timeline written by AI: a button, never a side effect of opening the page (it used to run on its own on the first visit). */
export function useGeneratePhases(journeyId: number) {
  return useReportedMutation({
    mutationFn: async () => apiClient.post(`/certifications/${journeyId}/generate-phases`),
    success: 'The certification timeline is ready',
    failure: "The AI couldn't write the timeline",
    invalidate: [['journey-phases', journeyId], ['certification', journeyId]],
  });
}
