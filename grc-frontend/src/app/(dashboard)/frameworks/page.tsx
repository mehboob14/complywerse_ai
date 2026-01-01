'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { frameworksApi } from '@/lib/api';
import { Framework, Domain } from '@/types';
import { 
  FileStack, 
  ChevronDown, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  Shield,
  CheckCircle,
  Clock
} from 'lucide-react';

export default function FrameworksPage() {
  const [expandedFramework, setExpandedFramework] = useState<string | null>(null);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  const { data: frameworks, isLoading, error } = useQuery({
    queryKey: ['frameworks'],
    queryFn: async () => {
      const response = await frameworksApi.getAll();
      return response.data;
    },
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
        <p>Failed to load frameworks</p>
      </div>
    );
  }

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'bg-green-500';
    if (progress >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Compliance Frameworks</h1>
        <p className="text-slate-400">Manage and track your compliance frameworks</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {frameworks?.map((framework: Framework) => {
          const isExpanded = expandedFramework === framework.id;
          const domainCount = framework.domains?.length || 0;
          const progress = Math.floor(Math.random() * 40) + 60;
          
          return (
            <div key={framework.id} className="card">
              <div 
                className="flex cursor-pointer items-start justify-between"
                onClick={() => setExpandedFramework(isExpanded ? null : framework.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-slate-700 p-2">
                    <FileStack className="h-6 w-6 text-primary-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{framework.name}</h3>
                    <p className="text-sm text-slate-400">v{framework.version}</p>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-5 w-5 text-slate-400" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                )}
              </div>

              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-slate-400">{domainCount} domains</span>
                <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                  {framework.source || 'Standard'}
                </span>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-400">Implementation</span>
                  <span className="text-white">{progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-700">
                  <div
                    className={`h-2 rounded-full ${getProgressColor(progress)}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {isExpanded && framework.domains && (
                <div className="mt-4 space-y-2 border-t border-slate-700 pt-4">
                  {framework.domains.map((domain: Domain) => {
                    const isDomainExpanded = expandedDomain === domain.id;
                    return (
                      <div key={domain.id} className="rounded-lg bg-slate-700/50 p-2">
                        <div
                          className="flex cursor-pointer items-center justify-between"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedDomain(isDomainExpanded ? null : domain.id);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            {isDomainExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            )}
                            <span className="text-sm text-slate-300">{domain.name}</span>
                          </div>
                          <span className="text-xs text-slate-500">
                            {domain.control_objectives?.length || 0} objectives
                          </span>
                        </div>
                        
                        {isDomainExpanded && domain.control_objectives && (
                          <div className="mt-2 space-y-1 pl-6">
                            {domain.control_objectives.map((objective) => (
                              <div 
                                key={objective.id}
                                className="flex items-center gap-2 rounded bg-slate-800 p-2 text-xs"
                              >
                                <Shield className="h-3 w-3 text-primary-400" />
                                <span className="font-mono text-slate-400">
                                  {objective.reference_code}
                                </span>
                                <span className="truncate text-slate-300">
                                  {objective.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(!frameworks || frameworks.length === 0) && (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <FileStack className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No frameworks found</h3>
          <p className="mt-1 text-slate-400">Get started by adding a compliance framework</p>
        </div>
      )}
    </div>
  );
}
