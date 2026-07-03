'use client';

// Assign duties (RACI) for a stage — who is Responsible / Accountable / Consulted /
// Informed. Persists to the stage instance's assigned_roles via
// PUT .../stages/{key}/roles. The stage's suggested roles (from the catalog) are
// shown as guidance next to each row.

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, X, UserPlus } from 'lucide-react';
import { tpraApi, adminApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { StageRaci } from './constants';

const RACI_ROWS: Array<{ k: 'R' | 'A' | 'C' | 'I'; label: string; cls: string }> = [
  { k: 'R', label: 'Responsible', cls: 'bg-blue-100 text-blue-700' },
  { k: 'A', label: 'Accountable', cls: 'bg-red-100 text-red-700' },
  { k: 'C', label: 'Consulted', cls: 'bg-amber-100 text-amber-700' },
  { k: 'I', label: 'Informed', cls: 'bg-gray-100 text-gray-600' },
];

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

type RoleKey = 'R' | 'A' | 'C' | 'I';

export default function RaciPanel({
  assessmentId, stageKey, initial, suggested, onSaved,
}: {
  assessmentId: number;
  stageKey: string;
  initial?: Array<{ role?: string; user_id?: number }>;
  suggested: StageRaci;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  const { data: users } = useQuery({
    queryKey: ['admin-users-for-tpra-intake'],
    queryFn: async () => {
      try {
        const r = await adminApi.getUsers();
        return ((r.data || []) as Array<{ id: number; email?: string; full_name?: string; name?: string; first_name?: string; last_name?: string }>).map((u) => ({
          id: u.id,
          name: u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || `User ${u.id}`,
        }));
      } catch { return []; }
    },
  });
  const userName = (id: number) => (users || []).find((u) => u.id === id)?.name || `User ${id}`;

  const [roles, setRoles] = useState<Record<RoleKey, number[]>>(() => {
    const base: Record<RoleKey, number[]> = { R: [], A: [], C: [], I: [] };
    (initial || []).forEach((r) => {
      const k = (r.role || '') as RoleKey;
      if (base[k] && typeof r.user_id === 'number' && !base[k].includes(r.user_id)) base[k].push(r.user_id);
    });
    return base;
  });

  const addUser = (k: RoleKey, id: number) => {
    if (!id || roles[k].includes(id)) return;
    setRoles({ ...roles, [k]: [...roles[k], id] });
  };
  const removeUser = (k: RoleKey, id: number) => setRoles({ ...roles, [k]: roles[k].filter((x) => x !== id) });

  const flat = useMemo(
    () => (['R', 'A', 'C', 'I'] as RoleKey[]).flatMap((k) => roles[k].map((user_id) => ({ role: k, user_id }))),
    [roles],
  );

  const save = useMutation({
    mutationFn: () => tpraApi.saveRoles(assessmentId, stageKey, flat),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      onSaved?.();
      toast({ type: 'success', title: 'Duties assigned' });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-600">
        Assign the people accountable for this stage. The <span className="font-medium">suggested</span> roles come from the TPRA playbook — replace them with real names from your org.
      </p>

      <div className="space-y-3">
        {RACI_ROWS.map(({ k, label, cls }) => (
          <div key={k} className="rounded-xl border border-gray-200 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${cls}`}>{k}</span>
              <span className="text-xs font-semibold text-slate-800">{label}</span>
              {suggested[k]?.length > 0 && (
                <span className="text-[11px] text-gray-400">suggested: {suggested[k].join(', ')}</span>
              )}
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {roles[k].length === 0 && <span className="text-[11px] text-gray-400">No one assigned.</span>}
              {roles[k].map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                  {userName(id)}
                  {canEdit && (
                    <button onClick={() => removeUser(k, id)} aria-label="Remove" className="text-gray-400 hover:text-red-500">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5 text-gray-400" />
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) addUser(k, Number(e.target.value)); }}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                  <option value="">Add a person…</option>
                  {(users || []).filter((u) => !roles[k].includes(u.id)).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save assignments
          </button>
        </div>
      )}
    </div>
  );
}
