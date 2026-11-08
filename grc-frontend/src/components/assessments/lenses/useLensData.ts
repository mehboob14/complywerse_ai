'use client';

// The assessment as a lens reads it: the workspace's own cached read (the same query key, so opening a lens costs no request), the controls turned into lens items,
// and the tenant's SLA days. A lens never asks for the assessment itself.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KEYS, workspaceApi } from '../workspace/workspaceApi';
import { toLensItem, type LensItem } from './lensData';
import type { LensDetail } from './lensApi';

export function useLensData(assessmentId: number) {
  const q = useQuery({ queryKey: KEYS.detail(assessmentId), queryFn: () => workspaceApi.detail(assessmentId), staleTime: 15_000 });
  const detail = q.data as unknown as LensDetail | undefined;
  const items = useMemo<LensItem[]>(() => (detail?.items ?? []).map(toLensItem), [detail]);
  return { query: q, detail, items };
}
