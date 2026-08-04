'use client';

// Assessment-level RACI team roster — assign the people ONCE and reuse them across
// every stage (no per-stage re-entry). Maps the org functions the TPRA playbook
// references (Business Owner, TPRM Lead/Analyst, Security, Privacy, Legal,
// Procurement, Exec approver, IT) to real users. Persists to assessment.team_roster.

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Users } from 'lucide-react';
import { tpraApi, adminApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

// Canonical roster roles — the distinct org functions across all 11 stages.
export const TEAM_ROLES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'business_owner', label: 'Business Owner', hint: 'Owns the relationship & the risk' },
  { key: 'tprm_lead', label: 'TPRM Lead', hint: 'Accountable for the assessment' },
  { key: 'tprm_analyst', label: 'TPRM Analyst', hint: 'Runs tiering, DD & scoring' },
  { key: 'security', label: 'Security', hint: 'Cyber control review' },
  { key: 'privacy', label: 'Privacy', hint: 'Data-protection review' },
  { key: 'legal', label: 'Legal', hint: 'Contract, DPA & clauses' },
  { key: 'procurement', label: 'Procurement', hint: 'Sourcing & commercial' },
  { key: 'exec_approver', label: 'Executive / Risk Committee', hint: 'Go / no-go approver' },
  { key: 'it', label: 'IT / Operations', hint: 'Access provisioning & onboarding' },
];

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function TeamRosterPanel({
  assessmentId, initial, onSaved,
}: { assessmentId: number; initial?: Record<string, number> | null; onSaved?: () => void }) {
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

  const [roster, setRoster] = useState<Record<string, number | ''>>({});
  useEffect(() => {
    const base: Record<string, number | ''> = {};
    TEAM_ROLES.forEach((r) => { base[r.key] = (initial && initial[r.key]) || ''; });
    setRoster(base);
  }, [initial]);

  const save = useMutation({
    mutationFn: () => {
      const clean: Record<string, number> = {};
      Object.entries(roster).forEach(([k, v]) => { if (v !== '' && v) clean[k] = Number(v); });
      return tpraApi.saveTeam(assessmentId, clean);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      onSaved?.();
      toast({ type: 'success', title: 'Team assigned' });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-600">
        <Users className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary-600" />
        Assign the assessment team <span className="font-medium">once</span> — these people carry across every stage. Each stage highlights which of them are involved; you never re-assign per stage.
      </p>

      <div className="space-y-2">
        {TEAM_ROLES.map((role) => (
          <div key={role.key} className="flex items-center gap-3 rounded-lg border border-gray-200 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-800">{role.label}</p>
              <p className="text-[11px] text-gray-400">{role.hint}</p>
            </div>
            <select
              value={roster[role.key] ?? ''}
              disabled={!canEdit}
              onChange={(e) => setRoster({ ...roster, [role.key]: e.target.value ? Number(e.target.value) : '' })}
              className="w-48 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">Unassigned</option>
              {(users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save team
          </button>
        </div>
      )}
    </div>
  );
}
