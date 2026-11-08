'use client';

/**
 * Who a control is assigned to: any number of people and departments, chosen in one list (kit MultiSelect). Every choice is saved at once (`PUT items/<id>/assignees`, the whole list), and a
 * refused save says so and leaves the list as it was. A department goes over the wire as type "team" (its picker record).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient, { assetsApi } from '@/lib/api';
import { MultiSelect, useReportedMutation, type ListOption } from '@/components/ui/ds';
import type { Assignee } from './itemModel';

const key = (a: Pick<Assignee, 'type' | 'id'>): string => `${a.type}:${a.id}`;

export function AssigneesField({ itemId, value, disabled, onSaved }: { itemId: number; value: readonly Assignee[]; disabled?: boolean; onSaved: (next: Assignee[]) => void }) {
  const people = useQuery({
    queryKey: ['assessment-assignee-people'], staleTime: 5 * 60 * 1000,
    queryFn: async () => ((await assetsApi.getTenantUsers()).data || []) as Array<{ id: number; display_name: string; email?: string }>,
  });
  const teams = useQuery({
    queryKey: ['assessment-assignee-teams'], staleTime: 5 * 60 * 1000,
    queryFn: async () => ((await apiClient.get('/admin/teams')).data || []) as Array<{ id: number; name: string }>,
  });
  const options = useMemo<ListOption[]>(() => {
    const seen = new Set<string>();
    const out: ListOption[] = [];
    const add = (o: ListOption) => { if (!seen.has(o.value)) { seen.add(o.value); out.push(o); } };
    for (const a of value) add({ value: key(a), label: a.name, description: a.type === 'team' ? 'Department' : undefined });     // already chosen: named even before the lists arrive
    for (const p of people.data ?? []) add({ value: `user:${p.id}`, label: p.display_name, description: p.email });
    for (const t of teams.data ?? []) add({ value: `team:${t.id}`, label: t.name, description: 'Department' });
    return out;
  }, [value, people.data, teams.data]);

  const save = useReportedMutation({
    mutationFn: async (next: Array<Pick<Assignee, 'type' | 'id'>>) => (await apiClient.put(`/compliance/assessments/items/${itemId}/assignees`, { assignees: next })).data as { assignees?: Assignee[] },
    failure: "Couldn't save who this is assigned to",
    onSuccess: (data) => onSaved(data.assignees ?? []),
  });

  return (
    <MultiSelect
      label="Assigned to" options={options} value={value.map(key)} display="chips" placeholder="Unassigned"
      searchPlaceholder="Search people and departments" disabled={disabled || save.isPending}
      onChange={(next) => save.mutate(next.map((v) => { const [type, id] = v.split(':'); return { type: type as Assignee['type'], id: Number(id) }; }))}
    />
  );
}
