'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { controlsApi } from '@/lib/api';
import { Control, NormalizedControl } from '@/types';
import { 
  Shield, 
  Loader2, 
  AlertCircle, 
  Search, 
  Filter,
  CheckCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

type StatusFilter = 'all' | 'implemented' | 'partial' | 'not_implemented';

export default function ControlsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedControl, setExpandedControl] = useState<string | null>(null);

  const { data: controls, isLoading, error } = useQuery({
    queryKey: ['controls'],
    queryFn: async () => {
      const response = await controlsApi.getAll();
      return response.data;
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'implemented':
        return (
          <span className="flex items-center gap-1 rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-400">
            <CheckCircle size={12} /> Implemented
          </span>
        );
      case 'partial':
        return (
          <span className="flex items-center gap-1 rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs text-yellow-400">
            <Clock size={12} /> Partial
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-400">
            <XCircle size={12} /> Not Implemented
          </span>
        );
    }
  };

  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      preventive: 'bg-blue-900/50 text-blue-400',
      detective: 'bg-purple-900/50 text-purple-400',
      corrective: 'bg-orange-900/50 text-orange-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${colors[type] || 'bg-slate-700 text-slate-400'}`}>
        {type}
      </span>
    );
  };

  const filteredControls = controls?.filter((control: Control) => {
    const matchesSearch = 
      control.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      control.reference_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      control.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (statusFilter === 'all') return matchesSearch;
    return matchesSearch;
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load controls</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Controls</h1>
        <p className="text-slate-400">Manage and track control implementations</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search controls..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="implemented">Implemented</option>
            <option value="partial">Partial</option>
            <option value="not_implemented">Not Implemented</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-700">
        <table className="w-full">
          <thead className="bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Control</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 md:table-cell">Type</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 lg:table-cell">Automation</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {filteredControls?.map((control: Control) => {
              const isExpanded = expandedControl === control.id;
              return (
                <>
                  <tr 
                    key={control.id} 
                    className="bg-slate-800/50 hover:bg-slate-700/50 cursor-pointer"
                    onClick={() => setExpandedControl(isExpanded ? null : control.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-primary-400" />
                        <div>
                          <p className="font-medium text-white">{control.reference_code}</p>
                          <p className="text-sm text-slate-400 line-clamp-1">{control.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {getTypeBadge(control.control_type)}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        control.automation_status === 'fully-automated' 
                          ? 'bg-green-900/50 text-green-400'
                          : control.automation_status === 'semi-automated'
                          ? 'bg-yellow-900/50 text-yellow-400'
                          : 'bg-slate-700 text-slate-400'
                      }`}>
                        {control.automation_status || 'Manual'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge('partial')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isExpanded ? (
                        <ChevronDown className="inline h-5 w-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="inline h-5 w-5 text-slate-400" />
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${control.id}-expanded`}>
                      <td colSpan={5} className="bg-slate-900 px-4 py-4">
                        <div className="space-y-3">
                          <div>
                            <h4 className="text-sm font-medium text-slate-300">Description</h4>
                            <p className="mt-1 text-sm text-slate-400">{control.description || 'No description available'}</p>
                          </div>
                          {control.implementation_guidance && (
                            <div>
                              <h4 className="text-sm font-medium text-slate-300">Implementation Guidance</h4>
                              <p className="mt-1 text-sm text-slate-400">{control.implementation_guidance}</p>
                            </div>
                          )}
                          {control.sub_controls && control.sub_controls.length > 0 && (
                            <div>
                              <h4 className="text-sm font-medium text-slate-300">Sub-Controls</h4>
                              <div className="mt-2 space-y-1">
                                {control.sub_controls.map((sub) => (
                                  <div key={sub.id} className="flex items-center gap-2 rounded bg-slate-800 p-2 text-sm">
                                    <span className="font-mono text-slate-400">{sub.reference_code}</span>
                                    <span className="text-slate-300">{sub.name}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {(!filteredControls || filteredControls.length === 0) && (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <Shield className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No controls found</h3>
          <p className="mt-1 text-slate-400">Try adjusting your search or filters</p>
        </div>
      )}
    </div>
  );
}
