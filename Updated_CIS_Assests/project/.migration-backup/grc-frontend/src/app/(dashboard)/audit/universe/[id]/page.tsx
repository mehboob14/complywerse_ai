'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  Shield,
  AlertTriangle,
  Target,
  User,
  Mail,
  Phone,
  FileText,
  Loader2,
  ChevronRight,
  BarChart3,
  Globe,
  Briefcase,
} from 'lucide-react';

const RISK_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const TABS = [
  { key: 'profile', label: 'Profile', icon: Building2 },
  { key: 'history', label: 'Audit History', icon: Clock },
  { key: 'risks', label: 'Linked Risks', icon: Shield },
  { key: 'coverage', label: 'Coverage', icon: Target },
];

export default function AuditUniverseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = Number(params.id);
  const [activeTab, setActiveTab] = useState('profile');

  const { data: entity, isLoading } = useQuery({
    queryKey: ['audit-entity', entityId],
    queryFn: () => auditApi.universe.getById(entityId).then(r => r.data),
    enabled: !!entityId,
  });

  const { data: coverageGaps } = useQuery({
    queryKey: ['coverage-gaps'],
    queryFn: () => auditApi.universe.getCoverageGaps().then(r => r.data),
    enabled: activeTab === 'coverage',
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="p-6">
        <button onClick={() => router.push('/audit/universe')} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Universe
        </button>
        <p className="text-slate-600">Entity not found.</p>
      </div>
    );
  }

  const auditHistory = entity.audit_history || [];
  const linkedRisks = entity.linked_risks || [];
  const daysSinceAudit = entity.last_audited_date
    ? Math.floor((Date.now() - new Date(entity.last_audited_date).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isOverdue = entity.next_audit_due && new Date(entity.next_audit_due) < new Date();
  const entityCoverage = coverageGaps ? (() => {
    const gaps = coverageGaps.gaps || coverageGaps;
    const overdue = (gaps.overdue || gaps.overdue_entities || []).find((e: any) => e.id === entityId);
    const never = (gaps.never_audited || []).find((e: any) => e.id === entityId);
    const upcoming = (gaps.upcoming_90_days || gaps.upcoming_audits || []).find((e: any) => e.id === entityId || e.entity_id === entityId);
    return { overdue, never, upcoming };
  })() : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/audit/universe')} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{entity.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-slate-600 capitalize">{entity.entity_type}</span>
              {entity.risk_rating && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${RISK_COLORS[entity.risk_rating] || 'bg-slate-100 text-slate-600'}`}>
                  {entity.risk_rating} risk
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entity.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {entity.status}
              </span>
              {isOverdue && <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 font-medium">Overdue</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-slate-400" />
            <p className="text-xs text-slate-500">Risk Score</p>
          </div>
          <p className={`text-2xl font-bold ${(entity.risk_score || 0) >= 80 ? 'text-red-600' : (entity.risk_score || 0) >= 60 ? 'text-orange-600' : (entity.risk_score || 0) >= 40 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {entity.risk_score?.toFixed(0) || '—'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-4 h-4 text-slate-400" />
            <p className="text-xs text-slate-500">Last Audited</p>
          </div>
          <p className="text-lg font-bold text-slate-900">
            {entity.last_audited_date ? new Date(entity.last_audited_date).toLocaleDateString() : 'Never'}
          </p>
          {daysSinceAudit != null && <p className="text-xs text-slate-500">{daysSinceAudit} days ago</p>}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-slate-400" />
            <p className="text-xs text-slate-500">Audit Cycle</p>
          </div>
          <p className="text-lg font-bold text-slate-900">{entity.audit_cycle_months || 12} months</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-slate-400" />
            <p className="text-xs text-slate-500">Next Audit Due</p>
          </div>
          <p className={`text-lg font-bold ${isOverdue ? 'text-red-600' : 'text-slate-900'}`}>
            {entity.next_audit_due ? new Date(entity.next_audit_due).toLocaleDateString() : 'Not set'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 bg-white p-1 rounded-lg border border-slate-200 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'profile' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Entity Details</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-slate-400 mt-0.5" />
                <div>
                  <p className="text-xs text-slate-500">Entity Type</p>
                  <p className="text-sm text-slate-900 capitalize">{entity.entity_type}</p>
                </div>
              </div>
              {entity.industry && (
                <div className="flex items-start gap-3">
                  <Globe className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Industry</p>
                    <p className="text-sm text-slate-900">{entity.industry}</p>
                  </div>
                </div>
              )}
              {entity.description && (
                <div className="flex items-start gap-3">
                  <FileText className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Description</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{entity.description}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Contact Information</h2>
            {(entity.contact_name || entity.contact_email || entity.contact_phone) ? (
              <div className="space-y-3">
                {entity.contact_name && (
                  <div className="flex items-center gap-3">
                    <User className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-xs text-slate-500">Contact Name</p>
                      <p className="text-sm text-slate-900">{entity.contact_name}</p>
                      {entity.contact_designation && <p className="text-xs text-slate-500">{entity.contact_designation}</p>}
                    </div>
                  </div>
                )}
                {entity.contact_email && (
                  <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-xs text-slate-500">Email</p>
                      <p className="text-sm text-blue-600">{entity.contact_email}</p>
                    </div>
                  </div>
                )}
                {entity.contact_phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-xs text-slate-500">Phone</p>
                      <p className="text-sm text-slate-900">{entity.contact_phone}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No contact information available.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Audit History</h2>
          {auditHistory.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No audit history for this entity.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {auditHistory.map((audit: any, i: number) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">{audit.title || audit.engagement_title || `Audit ${i + 1}`}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${audit.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                        {audit.status || 'completed'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                      {audit.engagement_type && <span className="capitalize">{audit.engagement_type}</span>}
                      {(audit.planned_start || audit.start_date) && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(audit.planned_start || audit.start_date).toLocaleDateString()}</span>}
                      {audit.opinion && <span className={`px-1.5 py-0.5 rounded text-xs ${audit.opinion === 'satisfactory' ? 'bg-emerald-100 text-emerald-700' : audit.opinion === 'unsatisfactory' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{audit.opinion}</span>}
                    </div>
                    {audit.finding_count != null && (
                      <p className="text-xs text-slate-500 mt-1">{audit.finding_count} findings</p>
                    )}
                  </div>
                  <button onClick={() => router.push(`/audit/engagements/${audit.id || audit.engagement_id}`)} className="p-1 hover:bg-slate-200 rounded">
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'risks' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Linked Risks ({linkedRisks.length})</h2>
          {linkedRisks.length === 0 ? (
            <div className="text-center py-8">
              <Shield className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No linked risks found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {linkedRisks.map((risk: any, i: number) => (
                <div key={i} className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <div className={`w-3 h-10 rounded-full ${(risk.inherent_score || risk.risk_score || 0) >= 80 ? 'bg-red-500' : (risk.inherent_score || risk.risk_score || 0) >= 60 ? 'bg-orange-500' : (risk.inherent_score || risk.risk_score || 0) >= 40 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-slate-900">{risk.title || risk.name}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      {risk.category && <span className="capitalize">{risk.category}</span>}
                      {risk.status && <span className="capitalize">{risk.status}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${(risk.inherent_score || risk.risk_score || 0) >= 80 ? 'text-red-600' : (risk.inherent_score || risk.risk_score || 0) >= 60 ? 'text-orange-600' : 'text-amber-600'}`}>
                      {(risk.inherent_score || risk.risk_score || 0).toFixed(0)}
                    </p>
                    <p className="text-xs text-slate-500">Risk Score</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'coverage' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Coverage Status</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className={`p-4 rounded-lg border ${entityCoverage?.never ? 'bg-red-50 border-red-200' : entityCoverage?.overdue ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <p className={`text-sm font-medium ${entityCoverage?.never ? 'text-red-700' : entityCoverage?.overdue ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {entityCoverage?.never ? 'Never Audited' : entityCoverage?.overdue ? 'Overdue' : 'On Schedule'}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  {entityCoverage?.never
                    ? 'This entity has never been audited'
                    : entityCoverage?.overdue
                      ? `Overdue since ${new Date(entity.next_audit_due).toLocaleDateString()}`
                      : entity.next_audit_due
                        ? `Next audit due ${new Date(entity.next_audit_due).toLocaleDateString()}`
                        : 'No schedule set'}
                </p>
              </div>
              <div className="p-4 rounded-lg border bg-slate-50 border-slate-200">
                <p className="text-sm font-medium text-slate-700">Audit Frequency</p>
                <p className="text-2xl font-bold text-slate-900">{entity.audit_cycle_months || 12}<span className="text-sm font-normal text-slate-500 ml-1">months</span></p>
              </div>
              <div className="p-4 rounded-lg border bg-slate-50 border-slate-200">
                <p className="text-sm font-medium text-slate-700">Total Audits</p>
                <p className="text-2xl font-bold text-slate-900">{auditHistory.length}</p>
              </div>
            </div>
          </div>
          {auditHistory.length >= 2 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Audit Trend</h2>
              <div className="space-y-2">
                {auditHistory.slice(0, 5).map((audit: any, i: number) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-28 text-xs text-slate-500 truncate">{audit.title || `Audit ${auditHistory.length - i}`}</div>
                    <div className="flex-1 flex items-center gap-2">
                      {(audit.planned_start || audit.start_date) && (
                        <span className="text-xs text-slate-400">{new Date(audit.planned_start || audit.start_date).getFullYear()}</span>
                      )}
                      <div className="flex-1 h-3 bg-slate-100 rounded-full">
                        <div className={`h-full rounded-full ${audit.opinion === 'satisfactory' ? 'bg-emerald-400' : audit.opinion === 'unsatisfactory' ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${audit.finding_count ? Math.min(audit.finding_count * 10, 100) : 30}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{audit.finding_count ?? '?'} findings</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
