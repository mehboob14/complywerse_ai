'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, X, Trash2, Edit2, UserPlus, Loader2, ShieldCheck, AlertCircle,
} from 'lucide-react';
import { teamsApi, assetsApi, type Team, type TeamMember } from '@/lib/api';
import { PageLoader } from '@/components/ui';

const TEAM_ROLES = [
  { value: 'lead', label: 'Lead' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
] as const;

const ROLE_STYLES: Record<string, string> = {
  lead: 'border-blue-200 bg-blue-50 text-blue-700',
  member: 'border-slate-200 bg-slate-50 text-slate-700',
  viewer: 'border-slate-200 bg-white text-slate-600',
};

export default function TeamsAdminPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [managing, setManaging] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const { data: teams, isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list(true).then((r) => r.data),
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users'],
    queryFn: () => assetsApi.getTenantUsers().then((r) => r.data),
    staleTime: 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => teamsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      setOkMessage('Team deleted.');
    },
    onError: (e: unknown) => setError(extractError(e) || 'Delete failed.'),
  });

  if (isLoading) return <PageLoader className="h-64" />;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700 text-sm flex items-center justify-between">
          <span><AlertCircle size={14} className="inline mr-2" />{error}</span>
          <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}
      {okMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-700 text-sm flex items-center justify-between">
          <span>{okMessage}</span>
          <button onClick={() => setOkMessage(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-card">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-black flex items-center gap-2">
            <Users size={16} className="text-slate-600" />
            Teams
          </h2>
          <button
            onClick={() => setCreateOpen(true)}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm flex items-center gap-1.5"
          >
            <Plus size={14} />
            New Team
          </button>
        </div>

        <div className="p-6">
          {(!teams || teams.length === 0) ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">No teams yet.</p>
              <p className="text-xs text-slate-400 mt-1">
                Create teams like &ldquo;Payments&rdquo;, &ldquo;Identity&rdquo;, or &ldquo;Platform Engineering&rdquo;
                so assets can pick an owning team from a dropdown.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2">Name</th>
                    <th className="text-left">Lead</th>
                    <th className="text-left">Members</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2">
                        <p className="font-medium text-slate-900">{t.name}</p>
                        {t.description && (
                          <p className="text-xs text-slate-500 truncate max-w-md">{t.description}</p>
                        )}
                      </td>
                      <td className="text-slate-700">{t.lead_user_name || '—'}</td>
                      <td className="text-slate-700">{t.member_count}</td>
                      <td>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${t.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-100 text-slate-600'}`}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => setManaging(t)}
                            className="px-2 py-1 border border-blue-300 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100 inline-flex items-center gap-1"
                            title="Manage members"
                          >
                            <UserPlus size={11} />
                            Members
                          </button>
                          <button
                            onClick={() => setEditing(t)}
                            className="px-2 py-1 border border-slate-300 bg-white text-slate-700 rounded text-xs hover:bg-slate-50 inline-flex items-center gap-1"
                            title="Edit"
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete team "${t.name}"? Any assets pointing here will have their team cleared.`)) {
                                deleteMutation.mutate(t.id);
                              }
                            }}
                            className="px-2 py-1 border border-rose-300 bg-rose-50 text-rose-700 rounded text-xs hover:bg-rose-100"
                            title="Delete"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <TeamFormModal
          mode="create"
          users={tenantUsers || []}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['teams'] });
            setOkMessage('Team created.');
          }}
          onError={setError}
        />
      )}

      {editing && (
        <TeamFormModal
          mode="edit"
          team={editing}
          users={tenantUsers || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['teams'] });
            setOkMessage('Team updated.');
          }}
          onError={setError}
        />
      )}

      {managing && (
        <MembersModal
          team={managing}
          users={tenantUsers || []}
          onClose={() => setManaging(null)}
          onAnyChange={() => qc.invalidateQueries({ queryKey: ['teams'] })}
          onError={setError}
        />
      )}
    </div>
  );
}

// ── Create / Edit modal ──────────────────────────────────────────────────────

function TeamFormModal({
  mode,
  team,
  users,
  onClose,
  onSaved,
  onError,
}: {
  mode: 'create' | 'edit';
  team?: Team;
  users: Array<{ id: number; display_name: string; email: string }>;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(team?.name || '');
  const [description, setDescription] = useState(team?.description || '');
  const [leadId, setLeadId] = useState<number | ''>(team?.lead_user_id || '');
  const [isActive, setIsActive] = useState(team?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onError('Team name is required.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'create') {
        await teamsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          lead_user_id: typeof leadId === 'number' ? leadId : undefined,
        });
      } else if (team) {
        await teamsApi.update(team.id, {
          name: name.trim(),
          description: description.trim() || '',
          lead_user_id: typeof leadId === 'number' ? leadId : undefined,
          is_active: isActive,
        });
      }
      onSaved();
    } catch (err: unknown) {
      onError(extractError(err) || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            {mode === 'create' ? 'Create team' : `Edit team — ${team?.name}`}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              placeholder="Payments / Identity / Platform Engineering"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lead</label>
            <select
              value={leadId === '' ? '' : leadId}
              onChange={(e) => setLeadId(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">— None —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} ({u.email})
                </option>
              ))}
            </select>
          </div>
          {mode === 'edit' && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Active
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 bg-white text-slate-700 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Members modal ────────────────────────────────────────────────────────────

function MembersModal({
  team,
  users,
  onClose,
  onAnyChange,
  onError,
}: {
  team: Team;
  users: Array<{ id: number; display_name: string; email: string }>;
  onClose: () => void;
  onAnyChange: () => void;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [addUserId, setAddUserId] = useState<number | ''>('');
  const [addRole, setAddRole] = useState<'lead' | 'member' | 'viewer'>('member');
  const [busy, setBusy] = useState(false);

  const { data: members, isLoading } = useQuery({
    queryKey: ['team-members', team.id],
    queryFn: () => teamsApi.listMembers(team.id).then((r) => r.data),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      teamsApi.addMember(team.id, { user_id: Number(addUserId), role_in_team: addRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-members', team.id] });
      onAnyChange();
      setAddUserId('');
    },
    onError: (e: unknown) => onError(extractError(e) || 'Add failed.'),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: number) => teamsApi.removeMember(team.id, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-members', team.id] });
      onAnyChange();
    },
    onError: (e: unknown) => onError(extractError(e) || 'Remove failed.'),
  });

  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: number; role: 'lead' | 'member' | 'viewer' }) =>
      teamsApi.updateMember(team.id, memberId, { role_in_team: role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-members', team.id] }),
    onError: (e: unknown) => onError(extractError(e) || 'Update failed.'),
  });

  const memberUserIds = new Set((members || []).map((m) => m.user_id));
  const candidateUsers = users.filter((u) => !memberUserIds.has(u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Members — {team.name}
            </h2>
            <p className="text-xs text-slate-500">
              {(members || []).length} member{(members || []).length === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex-1">
          {/* Add member form */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Add a member</p>
            <div className="flex flex-wrap gap-2">
              <select
                value={addUserId === '' ? '' : addUserId}
                onChange={(e) => setAddUserId(e.target.value ? Number(e.target.value) : '')}
                className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="">— pick a user —</option>
                {candidateUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email})
                  </option>
                ))}
              </select>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as 'lead' | 'member' | 'viewer')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                {TEAM_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addUserId && addMutation.mutate()}
                disabled={!addUserId || addMutation.isPending || busy}
                className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {addMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                Add
              </button>
            </div>
          </div>

          {/* Member list */}
          {isLoading ? (
            <PageLoader className="h-32" />
          ) : (!members || members.length === 0) ? (
            <div className="text-center py-8 text-sm text-slate-500">
              No members yet. Add the first one above.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2">User</th>
                  <th className="text-left">Role in team</th>
                  <th className="text-left">Added</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <p className="font-medium text-slate-900">{m.user_display_name}</p>
                      <p className="text-xs text-slate-500">{m.user_email}</p>
                    </td>
                    <td>
                      <select
                        value={m.role_in_team}
                        onChange={(e) => roleMutation.mutate({
                          memberId: m.id, role: e.target.value as 'lead' | 'member' | 'viewer',
                        })}
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${ROLE_STYLES[m.role_in_team] || ROLE_STYLES.member}`}
                      >
                        {TEAM_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs text-slate-600">
                      {new Date(m.added_at).toLocaleDateString()}
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => removeMutation.mutate(m.id)}
                        disabled={removeMutation.isPending && removeMutation.variables === m.id}
                        className="px-2 py-1 border border-rose-300 bg-rose-50 text-rose-700 rounded text-xs hover:bg-rose-100 inline-flex items-center gap-1"
                        title="Remove"
                      >
                        <X size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 bg-white text-slate-700 rounded-lg text-sm hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function extractError(e: unknown): string | null {
  return (
    (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
    (e as { message?: string })?.message ||
    null
  );
}
