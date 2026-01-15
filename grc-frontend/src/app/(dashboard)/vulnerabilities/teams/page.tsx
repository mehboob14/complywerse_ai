'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  Users,
  Plus,
  Loader2,
  Search,
  MoreVertical,
  Edit2,
  Trash2,
  X,
  UserPlus,
  Bug,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface Team {
  id: number;
  name: string;
  description?: string;
  member_count?: number;
  vulnerability_count?: number;
  created_at: string;
}

interface TeamMember {
  id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  role: string;
  added_at: string;
}

interface TeamVulnerability {
  id: number;
  vulnerability_id: number;
  vuln_id: string;
  title: string;
  severity: string;
  status: string;
  role: string;
}

export default function TeamsManagementPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  const { data: teams, isLoading } = useQuery({
    queryKey: ['all-teams'],
    queryFn: async () => {
      const response = await vulnManagementApi.teams.getAll();
      return response.data as Team[];
    },
  });

  const { data: teamMembers } = useQuery({
    queryKey: ['team-members', selectedTeam?.id],
    queryFn: async () => {
      if (!selectedTeam) return [];
      const response = await vulnManagementApi.teams.getMembers(selectedTeam.id);
      return response.data as TeamMember[];
    },
    enabled: !!selectedTeam && showMemberModal,
  });

  const { data: teamVulnerabilities } = useQuery({
    queryKey: ['team-vulnerabilities', selectedTeam?.id],
    queryFn: async () => {
      if (!selectedTeam) return [];
      const response = await vulnManagementApi.teams.getTeamVulnerabilities(selectedTeam.id);
      return response.data as TeamVulnerability[];
    },
    enabled: !!selectedTeam,
  });

  const createTeamMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => 
      vulnManagementApi.teams.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-teams'] });
      setShowCreateModal(false);
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; description?: string } }) => 
      vulnManagementApi.teams.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-teams'] });
      setShowEditModal(false);
      setSelectedTeam(null);
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: (id: number) => vulnManagementApi.teams.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-teams'] });
      setActiveMenuId(null);
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ teamId, data }: { teamId: number; data: { user_id: number; role?: string } }) => 
      vulnManagementApi.teams.addMember(teamId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', selectedTeam?.id] });
      queryClient.invalidateQueries({ queryKey: ['all-teams'] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ teamId, memberId }: { teamId: number; memberId: number }) => 
      vulnManagementApi.teams.removeMember(teamId, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', selectedTeam?.id] });
      queryClient.invalidateQueries({ queryKey: ['all-teams'] });
    },
  });

  const filteredTeams = teams?.filter(team => 
    team.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    team.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const severityStyles: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400',
    high: 'bg-orange-500/20 text-orange-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    low: 'bg-blue-500/20 text-blue-400',
    info: 'bg-slate-500/20 text-slate-400',
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vulnerability Teams</h1>
          <p className="text-slate-400 mt-1">Manage teams responsible for vulnerability remediation</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} />
          Create Team
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search teams..."
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {(!filteredTeams || filteredTeams.length === 0) ? (
          <div className="col-span-full rounded-xl border border-slate-700 bg-slate-800 p-12 text-center">
            <Users className="h-12 w-12 mx-auto text-slate-600 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No teams found</h3>
            <p className="text-slate-400 mb-4">Create your first team to start assigning vulnerabilities</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus size={16} />
              Create Team
            </button>
          </div>
        ) : (
          filteredTeams.map((team) => (
            <div
              key={team.id}
              className="rounded-xl border border-slate-700 bg-slate-800 p-6 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/20">
                    <Users className="h-5 w-5 text-primary-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{team.name}</h3>
                    {team.description && (
                      <p className="text-sm text-slate-400 line-clamp-1">{team.description}</p>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setActiveMenuId(activeMenuId === team.id ? null : team.id)}
                    className="p-1 text-slate-400 hover:text-white rounded"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {activeMenuId === team.id && (
                    <div className="absolute right-0 mt-1 w-36 rounded-lg border border-slate-700 bg-slate-800 shadow-xl z-10">
                      <button
                        onClick={() => {
                          setSelectedTeam(team);
                          setShowEditModal(true);
                          setActiveMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setSelectedTeam(team);
                          setShowMemberModal(true);
                          setActiveMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                      >
                        <UserPlus size={14} />
                        Members
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this team?')) {
                            deleteTeamMutation.mutate(team.id);
                          }
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-slate-700"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm mb-4">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Users size={14} />
                  <span>{team.member_count || 0} members</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Bug size={14} />
                  <span>{team.vulnerability_count || 0} vulnerabilities</span>
                </div>
              </div>

              <button
                onClick={() => setSelectedTeam(selectedTeam?.id === team.id ? null : team)}
                className="w-full text-left text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1"
              >
                View assigned vulnerabilities
                <ChevronRight size={14} className={selectedTeam?.id === team.id ? 'rotate-90' : ''} />
              </button>

              {selectedTeam?.id === team.id && teamVulnerabilities && (
                <div className="mt-4 space-y-2 border-t border-slate-700 pt-4">
                  {teamVulnerabilities.length === 0 ? (
                    <p className="text-sm text-slate-500">No vulnerabilities assigned</p>
                  ) : (
                    teamVulnerabilities.slice(0, 5).map((vuln) => (
                      <Link
                        key={vuln.id}
                        href={`/vulnerabilities/${vuln.vulnerability_id}`}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${severityStyles[vuln.severity] || severityStyles.info}`}>
                            {vuln.severity}
                          </span>
                          <span className="text-sm text-white truncate max-w-[150px]">{vuln.title}</span>
                        </div>
                        <span className="text-xs text-slate-500">{vuln.role}</span>
                      </Link>
                    ))
                  )}
                  {teamVulnerabilities.length > 5 && (
                    <p className="text-xs text-slate-500 text-center">
                      +{teamVulnerabilities.length - 5} more
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Create Team</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createTeamMutation.mutate({
                  name: formData.get('name') as string,
                  description: formData.get('description') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Team Name *</label>
                <input type="text" name="name" required className="input-field w-full" placeholder="e.g., Security Team" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                <textarea name="description" rows={3} className="input-field w-full" placeholder="Team responsibilities..." />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createTeamMutation.isPending} className="btn-primary">
                  {createTeamMutation.isPending ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && selectedTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Edit Team</h2>
              <button onClick={() => { setShowEditModal(false); setSelectedTeam(null); }} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                updateTeamMutation.mutate({
                  id: selectedTeam.id,
                  data: {
                    name: formData.get('name') as string,
                    description: formData.get('description') as string || undefined,
                  },
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Team Name *</label>
                <input type="text" name="name" required defaultValue={selectedTeam.name} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                <textarea name="description" rows={3} defaultValue={selectedTeam.description || ''} className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => { setShowEditModal(false); setSelectedTeam(null); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={updateTeamMutation.isPending} className="btn-primary">
                  {updateTeamMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMemberModal && selectedTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Team Members - {selectedTeam.name}</h2>
              <button onClick={() => { setShowMemberModal(false); setSelectedTeam(null); }} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const userId = parseInt(formData.get('user_id') as string);
                if (userId) {
                  addMemberMutation.mutate({
                    teamId: selectedTeam.id,
                    data: {
                      user_id: userId,
                      role: formData.get('role') as string || 'member',
                    },
                  });
                  (e.target as HTMLFormElement).reset();
                }
              }}
              className="flex gap-2 mb-4"
            >
              <input
                type="number"
                name="user_id"
                placeholder="User ID"
                className="input-field flex-1"
                required
              />
              <select name="role" className="input-field w-32">
                <option value="member">Member</option>
                <option value="lead">Lead</option>
              </select>
              <button type="submit" disabled={addMemberMutation.isPending} className="btn-primary">
                <UserPlus size={16} />
              </button>
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(!teamMembers || teamMembers.length === 0) ? (
                <p className="text-sm text-slate-500 text-center py-4">No members in this team</p>
              ) : (
                teamMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-500/20 text-primary-400 text-sm font-medium">
                        {(member.user_name || 'U')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{member.user_name || `User #${member.user_id}`}</p>
                        <p className="text-xs text-slate-400">{member.user_email || member.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 capitalize">{member.role}</span>
                      <button
                        onClick={() => removeMemberMutation.mutate({ teamId: selectedTeam.id, memberId: member.id })}
                        className="text-slate-400 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => { setShowMemberModal(false); setSelectedTeam(null); }} className="btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
