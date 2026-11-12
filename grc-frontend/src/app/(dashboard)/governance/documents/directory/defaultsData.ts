'use client';

// The Approvals and Exceptions tabs' data: a unit's defaults (what is its own, what applies and where from), the organisation's own (a line under a card that overrides it), who can be
// asked, and what a save or a revert refreshes. Every read has its own loading and failed state in the tab that draws it; a refusal (403) is not retried, it is said at once. The
// requests are lib/approvalDefaultsApi.ts's, the shapes lib/approvalDefaults.ts's.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULTS_KEY, defaultsKey, readDefaults, readTargets, targetsKey, type UnitRef } from '@/lib/approvalDefaultsApi';
import type { Subject, SubjectState } from '@/lib/approvalDefaults';
import { canRetry } from '@/components/ui/ds/reportOutcome';

/** A unit's defaults. `unit` 'org' is the organisation's own. */
export function useDefaults(unit: UnitRef) {
  return useQuery({ queryKey: defaultsKey(unit), queryFn: () => readDefaults(unit), staleTime: 10_000, retry: (n, e) => n < 2 && canRetry(e) });
}

/** The organisation's own defaults, read quietly: a person who may read a unit's but not the organisation's (a manager of one unit) just does not get the line. */
export function useOrganisationDefaults(enabled: boolean) {
  return useQuery({ queryKey: defaultsKey('org'), queryFn: () => readDefaults('org'), enabled, staleTime: 30_000, retry: false });
}

/** Who can be asked, with the two owners named for the unit; only read when the person can change something (`enabled`). */
export function useTargets(unit: UnitRef, enabled: boolean) {
  return useQuery({ queryKey: targetsKey(unit), queryFn: () => readTargets(unit), enabled, staleTime: 60_000, retry: (n, e) => n < 2 && canRetry(e) });
}

/** Everything a tab needs about one unit's defaults: its answer, the organisation's own state per subject (for a unit), and who can be asked (read only when the person can change something). */
export function useUnitDefaults(unit: UnitRef) {
  const answer = useDefaults(unit);
  const canEdit = answer.data?.can_edit === true;
  const org = useOrganisationDefaults(unit !== 'org' && answer.isSuccess);
  const targets = useTargets(unit, canEdit);
  const orgState = (subject: Subject): SubjectState | null => org.data?.subjects[subject] ?? null;
  return { answer, canEdit, targets, orgState };
}

/** After a save or a revert every unit's answer is out of date (a default changes what everything under it inherits), and so are the badges of the Details table. */
export function useRefreshDefaults(): () => void {
  const qc = useQueryClient();
  return useCallback(() => { void qc.invalidateQueries({ queryKey: DEFAULTS_KEY }); }, [qc]);
}

/** The tab holds typed input when any of its cards is being edited and changed: one flag for the popup's "Discard changes?". */
export function useDirtyReport(setDirty: ((dirty: boolean) => void) | undefined): (key: string, dirty: boolean) => void {
  const [map, setMap] = useState<Record<string, boolean>>({});
  const report = useRef(setDirty);
  report.current = setDirty;
  const any = useMemo(() => Object.values(map).some(Boolean), [map]);
  useEffect(() => { report.current?.(any); }, [any]);
  useEffect(() => () => report.current?.(false), []);
  return useCallback((key, dirty) => setMap((m) => (!!m[key] === dirty ? m : { ...m, [key]: dirty })), []);
}
