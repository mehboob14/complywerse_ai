'use client';

// The compliance artifacts of one requirement (catalog items the framework recommends for its clause, the suggestions made from what it asks for, and what the organisation made),
// asked for once the person opens the Artifacts tab or a checklist with sub-controls (never for every row of a list). The same calls as the Artifacts tab (`GET /artifacts/by-control`,
// `POST /artifacts`, `PUT /artifacts/{id}`), so an artifact made here shows there. The create and edit forms are the Artifacts tab's own (components/compliance/ArtifactsTab).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { useReportedMutation } from '@/components/ui/ds';
import type { CatalogItem, TenantArtifact } from '@/components/compliance/ArtifactsTab';
import type { CertificationControl } from '@/types';
import { artifactCodes, handMade, madeFor, suggestedArtifacts } from './artifactModel';

export interface ByControl {
  framework_key: string | null;
  framework_name?: string | null;
  control_ref: string;
  catalog: Array<CatalogItem & { sub_controls?: string[] | null }>;
  artifacts: TenantArtifact[];
}

const NO_CATALOG: ByControl['catalog'] = [];
const NO_MADE: TenantArtifact[] = [];

export function useRequirementArtifacts(control: CertificationControl, frameworkLabel: string, enabled: boolean) {
  const [creating, setCreating] = useState<CatalogItem | null>(null);
  const [editing, setEditing] = useState<TenantArtifact | null>(null);
  const subCodes = useMemo(() => (control.sub_control_tree ?? []).map((n) => n.code), [control.sub_control_tree]);
  const codes = useMemo(() => artifactCodes(control, subCodes), [control, subCodes]);
  const queryKey = ['requirement-artifacts', frameworkLabel, codes.join(',')];

  const query = useQuery({
    queryKey,
    queryFn: async () => (await apiClient.get('/artifacts/by-control', { params: { assessment_type: frameworkLabel, control_ref: codes.join(',') } })).data as ByControl,
    enabled: enabled && !!frameworkLabel && codes.length > 0,
    staleTime: 30_000,
  });

  // the Artifacts tab and this one read the same lists
  const refresh = [['requirement-artifacts'], ['tenant-artifacts']];
  const create = useReportedMutation<unknown, Record<string, unknown>>({
    mutationFn: async (payload) => (await apiClient.post('/artifacts', payload)).data,
    success: 'Artifact created',
    failure: "Couldn't create the artifact",
    retryable: false,
    invalidate: refresh,
    onSuccess: () => setCreating(null),
  });
  const update = useReportedMutation<unknown, { id: number; patch: Partial<TenantArtifact> }>({
    mutationFn: async ({ id, patch }) => (await apiClient.put(`/artifacts/${id}`, patch)).data,
    success: 'Artifact saved',
    failure: "Couldn't save the artifact",
    invalidate: refresh,
    onSuccess: () => setEditing(null),
  });

  const real = query.data?.catalog ?? NO_CATALOG;
  const made = query.data?.artifacts ?? NO_MADE;
  const ref = codes[0] ?? null;
  const catalog = useMemo(
    () => [...real, ...suggestedArtifacts(control.evidence_requirements as Array<{ name?: string; title?: string }> | undefined, real, ref)] as Array<CatalogItem & { sub_controls?: string[] | null }>,
    [real, control.evidence_requirements, ref],
  );
  return {
    query, catalog, made, handMade: handMade(made),
    madeFor: (item: CatalogItem): TenantArtifact | undefined => madeFor(item, made),
    creating, setCreating, editing, setEditing, create, update,
  };
}
