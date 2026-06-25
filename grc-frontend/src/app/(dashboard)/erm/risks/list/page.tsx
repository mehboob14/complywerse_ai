'use client';

import { useState, useMemo, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import * as XLSX from 'xlsx';
import { adminApi, assetsApi, ermApi, teamsApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { ITAsset, Risk, RiskCategory, RiskStatus, RiskDashboard, HeatmapCell } from '@/types';
import {
  AlertTriangle,
  Loader2,
  AlertCircle,
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Shield,
  Edit2,
  Trash2,
  Upload,
  Download,
  CheckCircle,
  Lock,
  Unlock,
  ListTodo,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  Zap,
  Eye,
  PenLine,
  FileSpreadsheet,
  ClipboardCheck,
  Building2,
} from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import { SearchInput } from '@/components/ui/SearchInput';
import AiRecommendationSaver from '@/components/ai/AiRecommendationSaver';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { PageLoader } from '@/components/ui';
import NcaRiskRegisterTab from '@/components/risks/NcaRiskRegisterTab';
import NcaRiskQuickAddModal from '@/components/risks/NcaRiskQuickAddModal';
import RiskViewSwitcher from '@/components/risks/RiskViewSwitcher';
import { useRouter as useNextRouter, useSearchParams } from 'next/navigation';

type ScoreFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
const UBL_TEMPLATE_REGISTER_TYPE = 'UBL Template';
type UBLFieldInputType = 'text' | 'textarea' | 'select' | 'date' | 'number' | 'datalist';
type UBLFieldDef = {
  key: string;
  label: string;
  input: UBLFieldInputType;
  options?: string[];
  suggestions?: string[];
  placeholder?: string;
};
type UBLFieldSection = { id: string; title: string; keys: string[] };

// Source-type display vocab. Each entry carries its own colour band so the
// risk-list rows become self-descriptive: "where did this risk come from?"
// is answered at a glance by a colour + icon, not just a small grey chip.
type SourceStyle = {
  label: string;
  iconKey: 'pencil' | 'upload' | 'clipboard' | 'alert' | 'check' | 'shield' | 'spreadsheet' | 'building';
  badgeBg: string;
  badgeText: string;
  badgeRing: string;
};
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  register_import: 'Register import',
  assessment: 'Assessment',
  incident: 'Incident',
  rcsa: 'RCSA',
  framework_gap: 'Framework gap',
  ubl_import: 'UBL register',
  nca_import: 'NCA register',
};
const SOURCE_STYLES: Record<string, SourceStyle> = {
  manual:          { label: 'Manual',          iconKey: 'pencil',      badgeBg: 'bg-slate-100',  badgeText: 'text-slate-700',  badgeRing: 'ring-slate-200' },
  register_import: { label: 'Register import', iconKey: 'upload',      badgeBg: 'bg-blue-100',   badgeText: 'text-blue-700',   badgeRing: 'ring-blue-200' },
  assessment:      { label: 'Assessment',      iconKey: 'clipboard',   badgeBg: 'bg-emerald-100',badgeText: 'text-emerald-700',badgeRing: 'ring-emerald-200' },
  incident:        { label: 'Incident',        iconKey: 'alert',       badgeBg: 'bg-rose-100',   badgeText: 'text-rose-700',   badgeRing: 'ring-rose-200' },
  rcsa:            { label: 'RCSA',            iconKey: 'check',       badgeBg: 'bg-amber-100',  badgeText: 'text-amber-800',  badgeRing: 'ring-amber-200' },
  framework_gap:   { label: 'Framework gap',   iconKey: 'shield',      badgeBg: 'bg-purple-100', badgeText: 'text-purple-700', badgeRing: 'ring-purple-200' },
  ubl_import:      { label: 'UBL register',    iconKey: 'spreadsheet', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-700', badgeRing: 'ring-indigo-200' },
  nca_import:      { label: 'NCA register',    iconKey: 'building',    badgeBg: 'bg-teal-100',   badgeText: 'text-teal-700',   badgeRing: 'ring-teal-200' },
};
const formatSourceLabel = (raw?: string | null): string => {
  if (!raw) return 'Unspecified';
  return SOURCE_LABELS[raw] || raw.replace(/_/g, ' ');
};
const getSourceStyle = (raw?: string | null): SourceStyle => {
  if (raw && SOURCE_STYLES[raw]) return SOURCE_STYLES[raw];
  return {
    label: formatSourceLabel(raw),
    iconKey: 'pencil',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    badgeRing: 'ring-slate-200',
  };
};

// Each source type gets a distinctive icon so a row reads at a glance —
// e.g. a teal "🏢 NCA register" chip vs. a rose "⚠ Incident" chip.
function renderSourceIcon(key: SourceStyle['iconKey']) {
  switch (key) {
    case 'pencil':      return <PenLine className="h-3 w-3" />;
    case 'upload':      return <Upload className="h-3 w-3" />;
    case 'clipboard':   return <ClipboardCheck className="h-3 w-3" />;
    case 'alert':       return <AlertCircle className="h-3 w-3" />;
    case 'check':       return <CheckCircle className="h-3 w-3" />;
    case 'shield':      return <Shield className="h-3 w-3" />;
    case 'spreadsheet': return <FileSpreadsheet className="h-3 w-3" />;
    case 'building':    return <Building2 className="h-3 w-3" />;
    default:            return <PenLine className="h-3 w-3" />;
  }
}

function SourceBadge({
  sourceType,
  sourceReference,
}: {
  sourceType: string;
  sourceReference: string | null;
}) {
  const style = getSourceStyle(sourceType);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${style.badgeBg} ${style.badgeText} ${style.badgeRing}`}
      title={`Originated from: ${style.label}${sourceReference ? ` (${sourceReference})` : ''}`}
    >
      {renderSourceIcon(style.iconKey)}
      <span>{style.label}</span>
      {sourceReference && (
        <span className="ml-1 rounded-full bg-white/70 px-1.5 font-mono text-[10px] text-gray-700">
          {sourceReference}
        </span>
      )}
    </span>
  );
}

const STANDARD_RISK_CATEGORIES: { value: RiskCategory; label: string; color: string; bgColor: string }[] = [
  { value: 'strategic', label: 'Strategic', color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  { value: 'operational', label: 'Operational', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'financial', label: 'Financial', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'compliance', label: 'Compliance', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'technology', label: 'Technology', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  { value: 'third_party', label: 'Third Party', color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  { value: 'project_change', label: 'Project/Change', color: 'text-pink-400', bgColor: 'bg-pink-500/20' },
  { value: 'internal', label: 'Internal', color: 'text-slate-700', bgColor: 'bg-slate-500/20' },
];

const UBL_RISK_CATEGORIES: { value: RiskCategory; label: string; color: string; bgColor: string }[] = [
  { value: 'isms', label: 'ISMS', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  { value: 'process', label: 'Process', color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  { value: 'other', label: 'Other', color: 'text-slate-700', bgColor: 'bg-slate-100' },
];

const RISK_CATEGORIES = [...STANDARD_RISK_CATEGORIES, ...UBL_RISK_CATEGORIES];
const UBL_ONLY_RISK_CATEGORIES: RiskCategory[] = ['technology', 'third_party', 'isms', 'process', 'other'];
const UBL_LOCATION_OPTIONS = ['', 'Bahrain', 'International', 'Pakistan', 'Qatar', 'UAE'];
const UBL_NON_EDITABLE_FIELD_KEYS = new Set(['source_sheet', 'risk_id']);
const UBL_PLATFORM_DUPLICATE_KEYS = new Set([
  'likelihood_raw',
  'impact_raw',
  'risk_value_raw',
  'risk_level_raw',
  'residual_risk_raw',
  'status_raw',
  'inherent_score',
  'residual_score',
  'mapped_status',
  'mapped_category',
]);
const UBL_HIDDEN_DISPLAY_KEYS = new Set([
  ...Array.from(UBL_PLATFORM_DUPLICATE_KEYS),
  'risk_category_raw',
  'sub_source_activity',
  'source_sheet',
]);

const UBL_FIELD_DEFS: UBLFieldDef[] = [
  {
    key: 'source',
    label: 'Source',
    input: 'datalist',
    suggestions: ['Internal', 'External', 'Threat Intelligence', 'Audit Finding', 'Incident', 'Regulatory'],
  },
  {
    key: 'location',
    label: 'Location',
    input: 'select',
    options: UBL_LOCATION_OPTIONS,
  },
  {
    key: 'type_or_security_triad',
    label: 'Type / Security Triad',
    input: 'datalist',
    suggestions: ['Confidentiality', 'Integrity', 'Availability', 'Cyber', 'Operational', 'Compliance'],
  },
  { key: 'application_name_or_asset', label: 'Application / Asset', input: 'text' },
  { key: 'ip_or_url', label: 'IP / URL', input: 'text' },
  {
    key: 'asset_criticality',
    label: 'Asset Criticality',
    input: 'select',
    options: ['', 'Critical', 'High', 'Medium', 'Low'],
  },
  {
    key: 'externally_exposed',
    label: 'Externally Exposed',
    input: 'select',
    options: ['', 'Yes', 'No'],
  },
  { key: 'vulnerability_count', label: 'Count of Vulnerabilities', input: 'number' },
  { key: 'vulnerabilities_identified', label: 'Vulnerabilities Identified', input: 'textarea' },
  { key: 'threat_due_to_vulnerability', label: 'Threat Due to Vulnerability', input: 'textarea' },
  { key: 'associated_risks', label: 'Associated Risks', input: 'textarea' },
  { key: 'risk_description_scenario', label: 'Risk Description (Scenario)', input: 'textarea' },
  { key: 'impact_business_regulatory_financial', label: 'Impact (Business/Regulatory/Financial)', input: 'textarea' },
  {
    key: 'cia_impacted',
    label: 'CIA Impacted',
    input: 'datalist',
    suggestions: ['Confidentiality', 'Integrity', 'Availability', 'Confidentiality, Integrity', 'Integrity, Availability'],
  },
  { key: 'recommended_controls', label: 'Recommended Controls', input: 'textarea' },
  { key: 'reported_date', label: 'Reported Date', input: 'date' },
  {
    key: 'mitigation_option',
    label: 'Mitigation Option',
    input: 'select',
    options: ['', 'Mitigate', 'Transfer', 'Accept', 'Avoid'],
  },
  { key: 'fixed_vulnerability_count', label: 'Count of Fixed Vulnerabilities', input: 'number' },
  {
    key: 'frequency',
    label: 'Frequency',
    input: 'select',
    options: ['', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'],
  },
  { key: 'business_justification', label: 'Business Justification', input: 'textarea' },
  { key: 'timeline', label: 'Timeline', input: 'text' },
  { key: 'compensating_controls', label: 'Compensating Controls', input: 'textarea' },
  {
    key: 'implementation_status',
    label: 'Implementation Status',
    input: 'select',
    options: ['', 'Not Started', 'In Progress', 'Implemented', 'Partially Implemented', 'Closed'],
  },
  { key: 'mitigation_date', label: 'Mitigation Date', input: 'date' },
  { key: 'risk_owner', label: 'Risk Owner', input: 'text' },
  { key: 'annex_a', label: 'Annex A', input: 'text' },
];

const UBL_FIELD_KEY_SET = new Set(UBL_FIELD_DEFS.map((field) => field.key));
const UBL_FIELD_DEF_MAP = new Map(UBL_FIELD_DEFS.map((field) => [field.key, field]));
const UBL_SUB_CATEGORY_SUGGESTIONS: Record<RiskCategory, string[]> = {
  technology: ['Access Management', 'Patch Management', 'Network Security', 'Application Security', 'Cloud Security', 'Data Protection', 'Business Continuity'],
  third_party: ['Vendor Due Diligence', 'Contractual Compliance', 'Service Availability', 'Data Sharing', 'Outsourcing Governance', 'Third-Party Monitoring'],
  process: ['Process Design', 'Process Ownership', 'Manual Error', 'Control Weakness', 'Change Handling', 'Service Delivery'],
  isms: ['Policy Compliance', 'Risk Governance', 'Control Effectiveness', 'Annex A Alignment', 'Awareness & Training', 'Incident Response'],
  other: ['General'],
  strategic: ['General'],
  operational: ['General'],
  financial: ['General'],
  compliance: ['General'],
  project_change: ['General'],
  internal: ['General'],
};

const UBL_FIELD_SECTIONS_BY_CATEGORY: Record<RiskCategory, UBLFieldSection[]> = {
  technology: [
    {
      id: 'risk_identification',
      title: 'Risk Identification',
      keys: [
        'source',
        'location',
        'type_or_security_triad',
        'application_name_or_asset',
        'ip_or_url',
        'asset_criticality',
        'externally_exposed',
        'vulnerability_count',
        'vulnerabilities_identified',
        'threat_due_to_vulnerability',
        'associated_risks',
        'risk_description_scenario',
        'cia_impacted',
      ],
    },
    {
      id: 'risk_analysis',
      title: 'Risk Analysis',
      keys: ['impact_business_regulatory_financial', 'reported_date'],
    },
    {
      id: 'risk_treatment',
      title: 'Risk Treatment',
      keys: [
        'recommended_controls',
        'mitigation_option',
        'fixed_vulnerability_count',
        'frequency',
        'business_justification',
        'timeline',
        'compensating_controls',
        'implementation_status',
        'mitigation_date',
        'risk_owner',
      ],
    },
  ],
  third_party: [
    {
      id: 'risk_identification',
      title: 'Risk Identification',
      keys: [
        'source',
        'location',
        'application_name_or_asset',
        'associated_risks',
        'risk_description_scenario',
        'impact_business_regulatory_financial',
      ],
    },
    {
      id: 'risk_analysis',
      title: 'Risk Analysis',
      keys: ['reported_date'],
    },
    {
      id: 'risk_treatment',
      title: 'Risk Treatment',
      keys: [
        'recommended_controls',
        'mitigation_option',
        'business_justification',
        'timeline',
        'implementation_status',
        'mitigation_date',
        'risk_owner',
      ],
    },
  ],
  process: [
    {
      id: 'risk_identification',
      title: 'Risk Identification',
      keys: ['source', 'location', 'associated_risks', 'risk_description_scenario', 'impact_business_regulatory_financial'],
    },
    {
      id: 'risk_analysis',
      title: 'Risk Analysis',
      keys: ['reported_date'],
    },
    {
      id: 'risk_treatment',
      title: 'Risk Treatment',
      keys: [
        'recommended_controls',
        'mitigation_option',
        'business_justification',
        'timeline',
        'compensating_controls',
        'implementation_status',
        'mitigation_date',
        'risk_owner',
      ],
    },
  ],
  isms: [
    {
      id: 'risk_identification',
      title: 'Risk Identification',
      keys: [
        'source',
        'location',
        'type_or_security_triad',
        'associated_risks',
        'risk_description_scenario',
        'impact_business_regulatory_financial',
        'cia_impacted',
        'annex_a',
      ],
    },
    {
      id: 'risk_analysis',
      title: 'Risk Analysis',
      keys: ['reported_date'],
    },
    {
      id: 'risk_treatment',
      title: 'Risk Treatment',
      keys: [
        'recommended_controls',
        'mitigation_option',
        'business_justification',
        'timeline',
        'compensating_controls',
        'implementation_status',
        'mitigation_date',
        'risk_owner',
      ],
    },
  ],
  other: [
    {
      id: 'risk_identification',
      title: 'Risk Identification',
      keys: ['source', 'location', 'associated_risks', 'risk_description_scenario', 'impact_business_regulatory_financial'],
    },
    {
      id: 'risk_analysis',
      title: 'Risk Analysis',
      keys: ['reported_date'],
    },
    {
      id: 'risk_treatment',
      title: 'Risk Treatment',
      keys: ['recommended_controls', 'mitigation_option', 'business_justification', 'timeline', 'implementation_status', 'mitigation_date', 'risk_owner'],
    },
  ],
  strategic: [],
  operational: [],
  financial: [],
  compliance: [],
  project_change: [],
  internal: [],
};

const UBL_DEFAULT_FIELD_SECTIONS: UBLFieldSection[] = [
  {
    id: 'risk_identification',
    title: 'Risk Identification',
    keys: [
      'source',
      'location',
      'associated_risks',
      'risk_description_scenario',
      'impact_business_regulatory_financial',
    ],
  },
  {
    id: 'risk_treatment',
    title: 'Risk Treatment',
    keys: [
      'recommended_controls',
      'mitigation_option',
      'fixed_vulnerability_count',
      'frequency',
      'business_justification',
      'timeline',
      'compensating_controls',
      'implementation_status',
      'mitigation_date',
      'risk_owner',
      'reported_date',
    ],
  },
];

const NCA_TEMPLATE_REGISTER_TYPE = 'NCA Template';

const REGISTER_TYPES = [
  { value: UBL_TEMPLATE_REGISTER_TYPE, label: 'Template' },
  { value: NCA_TEMPLATE_REGISTER_TYPE, label: 'NCA Template' },
  { value: 'PCI-DSS', label: 'PCI-DSS' },
  { value: 'ISO 27001', label: 'ISO 27001' },
  { value: 'SOX', label: 'SOX' },
  { value: 'GDPR', label: 'GDPR' },
  { value: 'NIST', label: 'NIST' },
  { value: 'SAMA CSF', label: 'SAMA CSF' },
  { value: 'Internal', label: 'Internal' },
  { value: 'Project-Based', label: 'Project-Based' },
  { value: 'Third-Party', label: 'Third-Party' },
  { value: 'Other', label: 'Other' },
];

const normalizeFilterValue = (value: string | null | undefined) =>
  (value || '').toString().trim().toLowerCase();

const canonicalFilterValue = (value: string | null | undefined) =>
  normalizeFilterValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const filterValuesMatch = (left: string | null | undefined, right: string | null | undefined) => {
  const leftCanonical = canonicalFilterValue(left);
  const rightCanonical = canonicalFilterValue(right);

  if (!leftCanonical || !rightCanonical) return false;
  return (
    leftCanonical === rightCanonical ||
    leftCanonical.includes(rightCanonical) ||
    rightCanonical.includes(leftCanonical)
  );
};

const isUBLRegisterTypeValue = (value: string | null | undefined) =>
  canonicalFilterValue(value) === canonicalFilterValue(UBL_TEMPLATE_REGISTER_TYPE);

const isNcaRegisterTypeValue = (value: string | null | undefined) =>
  canonicalFilterValue(value) === canonicalFilterValue(NCA_TEMPLATE_REGISTER_TYPE);

const isUBLAllowedCategoryValue = (value: string | null | undefined) =>
  UBL_ONLY_RISK_CATEGORIES.some((allowed) => filterValuesMatch(value, allowed));

const toInputString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const formatUblFieldLabel = (key: string): string =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

const compactTitle = (title: string, maxWords = 6): string => {
  const words = (title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return title;
  return `${words.slice(0, maxWords).join(' ')}...`;
};

const compactDescription = (description?: string | null): string => {
  if (!description) return '';
  const cleaned = description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^source\s*sheet\s*:/i.test(line) && !/\bubl\b/i.test(line))
    .join(' ');
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 14) return `${cleaned} ....`;
  return `${words.slice(0, 14).join(' ')} ....`;
};

const mapUblRawCategoryToRiskCategory = (value: string): RiskCategory | null => {
  const normalized = canonicalFilterValue(value);
  if (!normalized) return null;
  if (normalized.includes('thirdparty') || normalized.includes('3rdparty') || normalized.includes('vendor')) return 'third_party';
  if (normalized.includes('technology')) return 'technology';
  if (normalized.includes('isms')) return 'isms';
  if (normalized.includes('process')) return 'process';
  if (normalized.includes('other')) return 'other';
  return null;
};

const getRiskCategoryLabel = (category: RiskCategory): string =>
  RISK_CATEGORIES.find((item) => item.value === category)?.label || category;

const inferUblCategoryFromSheet = (sourceSheet: string | null | undefined): RiskCategory | null => {
  const normalized = canonicalFilterValue(sourceSheet || '');
  if (!normalized) return null;
  if (normalized.includes('technology')) return 'technology';
  if (normalized.includes('3rdparty') || normalized.includes('thirdparty')) return 'third_party';
  if (normalized.includes('process')) return 'process';
  if (normalized.includes('isms')) return 'isms';
  return null;
};

const getUblFieldSections = (
  riskCategory: RiskCategory | null | undefined,
  sourceSheet?: string | null,
): UBLFieldSection[] => {
  const fromCategory = riskCategory && UBL_ONLY_RISK_CATEGORIES.includes(riskCategory) ? riskCategory : null;
  const fromSheet = inferUblCategoryFromSheet(sourceSheet);
  const resolved = fromCategory || fromSheet || 'technology';
  return UBL_FIELD_SECTIONS_BY_CATEGORY[resolved] || UBL_DEFAULT_FIELD_SECTIONS;
};

const inferEffectiveRiskCategory = (risk: Risk): RiskCategory => {
  const legacyCategory = (risk as Risk & { category?: string }).category;
  const explicitCategoryCanonical = canonicalFilterValue((risk.risk_category || legacyCategory || '').trim());
  const explicitCategoryMap: Record<string, RiskCategory> = {
    strategic: 'strategic',
    operational: 'operational',
    financial: 'financial',
    compliance: 'compliance',
    technology: 'technology',
    thirdparty: 'third_party',
    projectchange: 'project_change',
    internal: 'internal',
    isms: 'isms',
    process: 'process',
    other: 'other',
  };
  if (explicitCategoryMap[explicitCategoryCanonical]) return explicitCategoryMap[explicitCategoryCanonical];

  const categoryText = [
    risk.risk_category,
    legacyCategory,
    risk.register_type,
    risk.title,
    risk.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(gdpr|privacy|lawfulness|data subject|regulatory|compliance|legal)/.test(categoryText)) return 'compliance';
  if (/(technology|cyber|security|network|system|information security|iso ?27001|nist|pci)/.test(categoryText)) return 'technology';
  if (/(financial|budget|cost|credit|liquidity|sox|soc ?2|basel)/.test(categoryText)) return 'financial';
  if (/(vendor|supplier|third party|outsourcing|partner)/.test(categoryText)) return 'third_party';
  if (/(project|change|implementation|transformation)/.test(categoryText)) return 'project_change';
  if (/(strategy|strategic|market|reputation|brand)/.test(categoryText)) return 'strategic';
  if (/(internal|fraud|governance|culture|integrity)/.test(categoryText)) return 'internal';
  if (/(isms|iso\/iec|annex a)/.test(categoryText)) return 'isms';
  if (/(process|workflow|procedure)/.test(categoryText)) return 'process';
  return 'operational';
};

const SUB_CATEGORIES_BY_CATEGORY: Record<RiskCategory, string[]> = {
  strategic: ['Market', 'Reputation', 'Strategic Planning', 'Competitive', 'Brand', 'Other'],
  operational: ['Process', 'Human Resources', 'Supply Chain', 'Business Continuity', 'Quality', 'Other'],
  financial: ['Credit', 'Market Risk', 'Liquidity', 'Accounting', 'Budget', 'Other'],
  compliance: ['Regulatory', 'Legal', 'Contractual', 'Ethical', 'Data Privacy', 'Other'],
  technology: ['Cybersecurity', 'Infrastructure', 'Data', 'System Availability', 'Software', 'Other'],
  third_party: ['Vendor', 'Outsourcing', 'Partnership', 'Contractor', 'Other'],
  project_change: ['Project Delivery', 'Change Management', 'Integration', 'Scope', 'Other'],
  internal: ['Fraud', 'Governance', 'Culture', 'Process Integrity', 'Other'],
  isms: ['Governance', 'ISO 27001', 'Policy', 'Compliance', 'Information Security', 'Other'],
  process: ['Process Design', 'Control Weakness', 'Manual Error', 'Service Delivery', 'Operations', 'Other'],
  other: ['General', 'Unclassified', 'Other'],
};

const DEPARTMENTS = [
  { id: 1, name: 'IT' },
  { id: 2, name: 'Finance' },
  { id: 3, name: 'Operations' },
  { id: 4, name: 'HR' },
  { id: 5, name: 'Legal' },
  { id: 6, name: 'Sales' },
  { id: 7, name: 'Marketing' },
  { id: 8, name: 'Security' },
];

const RISK_STATUSES: { value: RiskStatus; label: string; color: string; bgColor: string }[] = [
  { value: 'open', label: 'Open', color: 'text-red-400', bgColor: 'bg-red-500/20' },
  { value: 'in_treatment', label: 'In Treatment', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'mitigated', label: 'Mitigated', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'accepted', label: 'Accepted', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'closed', label: 'Closed', color: 'text-slate-600', bgColor: 'bg-slate-500/20' },
];

const getCategoryStyle = (category: string | null | undefined) => {
  const canonicalCategory = canonicalFilterValue(category);
  const matched = RISK_CATEGORIES.find((item) => canonicalFilterValue(item.value) === canonicalCategory);
  if (matched) return matched;

  const fallbackLabel = (category || 'Other')
    .toString()
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

  return {
    value: 'operational' as RiskCategory,
    label: fallbackLabel,
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
  };
};

const getStatusStyle = (status: RiskStatus) => {
  return RISK_STATUSES.find(s => s.value === status) || RISK_STATUSES[0];
};

const getScoreColor = (score: number | undefined) => {
  if (!score) return { text: 'text-slate-600', bg: 'bg-slate-500/20' };
  if (score >= 20) return { text: 'text-red-400', bg: 'bg-red-500/20' };
  if (score >= 12) return { text: 'text-orange-400', bg: 'bg-orange-500/20' };
  if (score >= 6) return { text: 'text-yellow-400', bg: 'bg-yellow-500/20' };
  return { text: 'text-green-400', bg: 'bg-green-500/20' };
};

const getHeatmapCellColor = (likelihood: number, impact: number) => {
  const score = likelihood * impact;
  if (score >= 20) return 'bg-red-500 hover:bg-red-600';
  if (score >= 15) return 'bg-red-400 hover:bg-red-500';
  if (score >= 12) return 'bg-orange-400 hover:bg-orange-500';
  if (score >= 8) return 'bg-yellow-400 hover:bg-yellow-500';
  if (score >= 4) return 'bg-lime-400 hover:bg-lime-500';
  return 'bg-green-500 hover:bg-green-600';
};

export default function ERMRisksPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:risks:create');
  const canEdit = hasPermission('erm:risks:edit');
  const canDelete = hasPermission('erm:risks:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<RiskStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [registerTypeFilter, setRegisterTypeFilter] = useState<string>('all');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [heatmapType, setHeatmapType] = useState<'inherent' | 'residual'>('inherent');
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState<{l: number, i: number} | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNcaAddOpen, setIsNcaAddOpen] = useState(false);
  // When set, the NCA modal opens in EDIT mode bound to this bridged Risk id.
  const [ncaEditBridgedId, setNcaEditBridgedId] = useState<number | null>(null);
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedRegisterType, setSelectedRegisterType] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<{ message: string; created: number; skipped: number; errors: string[] } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [expandedRiskRows, setExpandedRiskRows] = useState<Record<number, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const ncaAddRouter = useNextRouter();
  const isUBLFilterSelected = isUBLRegisterTypeValue(registerTypeFilter);
  const isNcaFilterSelected = isNcaRegisterTypeValue(registerTypeFilter);

  useEffect(() => {
    if (!isUBLFilterSelected) return;
    if (categoryFilter === 'all') return;
    if (!isUBLAllowedCategoryValue(categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [isUBLFilterSelected, categoryFilter]);

  // When the user picks the NCA Template filter, backfill bridges for any
  // legacy NCA risk entries that pre-date the bridge column. Without this,
  // those entries have no backing Risk record tagged with
  // register_type='NCA Template' and so stay invisible in this list.
  useEffect(() => {
    if (!isNcaFilterSelected) return;
    let cancelled = false;
    apiClient.post('/risks/nca/backfill-bridges')
      .then((res) => {
        if (cancelled) return;
        const newly = res.data?.newly_bridged ?? 0;
        if (newly > 0) {
          queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
          queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
        }
      })
      .catch(() => { /* silent — best-effort */ });
    return () => { cancelled = true; };
  }, [isNcaFilterSelected, queryClient]);

  const { data: risks, isLoading, error } = useQuery({
    queryKey: ['erm-risks'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  // Open the edit modal directly when arriving with `?edit=<risk_id>` in the URL.
  // Used by the "Edit" button on the general risk detail page (/risks/[id]) so
  // users can modify a risk without leaving the navigation flow.
  const searchParams = useSearchParams();
  const editIdParam = searchParams?.get('edit');
  useEffect(() => {
    if (!editIdParam || !risks || isModalOpen) return;
    const targetId = Number(editIdParam);
    if (!targetId) return;
    const target = (risks as Risk[]).find((r) => r.id === targetId);
    if (target) {
      setEditingRisk(target);
      setIsModalOpen(true);
      // Clean the URL so re-renders don't re-open the modal after the user closes it
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [editIdParam, risks, isModalOpen]);

  const { data: dashboard } = useQuery({
    queryKey: ['erm-risks-dashboard'],
    queryFn: async () => {
      const response = await ermApi.risks.getDashboard();
      return response.data;
    },
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['erm-risks-heatmap', heatmapType],
    queryFn: async () => {
      const response = await ermApi.risks.getHeatmap(heatmapType);
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Risk>) => ermApi.risks.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
      setIsModalOpen(false);
      setEditingRisk(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Risk> }) => ermApi.risks.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
      setIsModalOpen(false);
      setEditingRisk(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.risks.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
    },
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadResult(null);

    // ─── NCA Template path — parse client-side, POST each row to /risks/nca ─
    // The backend `upload_risk_register` is UBL-format-specific (looks for
    // sheets named "Technology Risk Register", etc.) and will skip every row
    // of an NCA template. Route NCA uploads through the NCA endpoint, which
    // also auto-bridges into the general Risk register.
    if (isNcaRegisterTypeValue(selectedRegisterType)) {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });

        // Pick the data sheet (skip Cover Page / Legend / Heat map / etc.)
        let ws: XLSX.WorkSheet | null = null;
        const preferred = wb.SheetNames.find((n) => {
          const s = n.toLowerCase();
          return s.includes('risk register') && !s.includes('legend');
        });
        if (preferred) ws = wb.Sheets[preferred];
        if (!ws) {
          for (const name of wb.SheetNames) {
            const cand = wb.Sheets[name];
            const probe: any[][] = XLSX.utils.sheet_to_json(cand, { header: 1, defval: '' }) as any;
            for (let r = 0; r < Math.min(probe.length, 20); r++) {
              const rowStr = (probe[r] || []).map((c) => String(c || '').toLowerCase()).join(' ');
              if (rowStr.includes('risk identifier') && rowStr.includes('threat')) { ws = cand; break; }
            }
            if (ws) break;
          }
        }
        if (!ws) throw new Error('Could not find a Risk Register sheet in this workbook');

        // Find the header row (NCA puts it at row 11 / idx 10)
        const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any;
        let headerRowIdx = 0;
        for (let r = 0; r < Math.min(allRows.length, 25); r++) {
          const rowStr = (allRows[r] || []).map((c) => String(c || '').toLowerCase()).join(' ');
          if (rowStr.includes('risk identifier') || (rowStr.includes('risk owner') && rowStr.includes('threat'))) {
            headerRowIdx = r;
            break;
          }
        }
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRowIdx, raw: false });

        let created = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const keys = Object.keys(r);
          const ci = (name: string) => {
            const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();
            const key = keys.find((k) => k.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(norm));
            return key ? r[key] : undefined;
          };
          const toStr = (v: any) => (v === null || v === undefined || v === '') ? null : String(v).trim() || null;
          const toInt = (v: any) => { const n = parseInt(v); return isNaN(n) ? null : n; };
          const toDate = (v: any) => {
            if (!v) return null;
            if (v instanceof Date) return v.toISOString().split('T')[0];
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
          };
          const stripPlaceholder = (v: string | null): string | null => {
            if (!v) return null;
            if (/^please\s+select/i.test(v.trim())) return null;
            return v;
          };

          const payload = {
            risk_area:                stripPlaceholder(toStr(ci('risk area'))),
            risk_owner:               stripPlaceholder(toStr(ci('risk owner'))),
            date_identified:          toDate(ci('date of risk identification')),
            description:              toStr(ci('description of the risk') ?? ci('description')),
            risk_cause:               toStr(ci('risk cause')),
            threat:                   stripPlaceholder(toStr(ci('threat'))),
            risk_analysis:            toStr(ci('risk analysis and consequences') ?? ci('risk analysis')),
            date_analysis:            toDate(ci('date of risk analysis')),
            inherent_likelihood:      toInt(ci('inherent risk likelihood')),
            inherent_impact:          toInt(ci('inherent risk magnitude') ?? ci('inherent risk impact')),
            inherent_rating_override: stripPlaceholder(toStr(ci('updated overall inherent risk rating') ?? ci('updated inherent risk rating'))),
            treatment_type:           stripPlaceholder(toStr(ci('type of treatment action'))),
            treatment_description:    toStr(ci('risk treatment description')),
            treatment_owner:          stripPlaceholder(toStr(ci('owner of the treatment') ?? ci('owner of treatment') ?? ci('treatment owner'))),
            treatment_deadline:       toDate(ci('deadline for action')),
            residual_description:     toStr(ci('residual risk description')),
            residual_likelihood:      toInt(ci('residual risk likelihood')),
            residual_impact:          toInt(ci('residual risk magnitude') ?? ci('residual risk impact')),
            following_steps:          toStr(ci('following steps description') ?? ci('following steps')),
            last_evaluation_date:     toDate(ci('last evaluation date')),
            comment:                  toStr(ci('comment')),
          };

          const meaningful = [
            payload.description, payload.risk_owner, payload.threat,
            payload.risk_cause, payload.risk_analysis, payload.treatment_description,
            payload.risk_area,
          ];
          if (!meaningful.some((v) => v !== null && v !== '' && v !== undefined)) continue;

          try {
            await apiClient.post('/risks/nca', payload);
            created++;
          } catch {
            errors.push(`Row ${headerRowIdx + i + 2}`);
          }
        }

        setUploadResult({
          message: `NCA template: imported ${created} risk${created === 1 ? '' : 's'}`,
          created,
          skipped: 0,
          errors,
        });
        queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
        queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
        queryClient.invalidateQueries({ queryKey: ['nca-risk-entries'] });
        setIsUploadModalOpen(false);
        setSelectedRegisterType('');
      } catch (err: any) {
        setUploadResult({
          message: err?.message || 'NCA template upload failed',
          created: 0,
          skipped: 0,
          errors: [err?.message || 'Upload failed'],
        });
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      return;
    }

    // ─── Standard / UBL path ────────────────────────────────────────────
    try {
      const response = await ermApi.risks.uploadRiskRegister(file, selectedRegisterType || undefined);
      setUploadResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
      setIsUploadModalOpen(false);
      setSelectedRegisterType('');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload file';
      setUploadResult({
        message: errorMessage,
        created: 0,
        skipped: 0,
        errors: [errorMessage],
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await ermApi.risks.downloadTemplate();
      const blob = new Blob([
        response.data,
      ], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'risk_register_template.xlsx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download risk register template', error);
      setUploadResult({
        message: 'Failed to download risk register template',
        created: 0,
        skipped: 0,
        errors: ['Template download failed'],
      });
    }
  };

  const heatmapMatrix = useMemo(() => {
    const matrix: Record<string, { count: number; risks: Array<{id: number; title: string; score: number}> }> = {};
    for (let l = 1; l <= 5; l++) {
      for (let i = 1; i <= 5; i++) {
        matrix[`${l}-${i}`] = { count: 0, risks: [] };
      }
    }
    
    if (heatmapData) {
      heatmapData.forEach((cell: HeatmapCell) => {
        matrix[`${cell.likelihood}-${cell.impact}`] = { count: cell.count, risks: cell.risks };
      });
    } else if (risks) {
      risks.forEach((risk: Risk) => {
        const likelihood = heatmapType === 'inherent' ? risk.inherent_likelihood : risk.residual_likelihood;
        const impact = heatmapType === 'inherent' ? risk.inherent_impact : risk.residual_impact;
        const score = heatmapType === 'inherent' ? risk.inherent_score : risk.residual_score;
        if (likelihood && impact) {
          const key = `${likelihood}-${impact}`;
          if (matrix[key]) {
            matrix[key].count++;
            matrix[key].risks.push({ id: risk.id, title: risk.title, score: score || 0 });
          }
        }
      });
    }
    return matrix;
  }, [risks, heatmapData, heatmapType]);

  const computedDashboard = useMemo(() => {
    if (dashboard) return dashboard;
    if (!risks) return null;
    
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalInherent = 0;
    let totalResidual = 0;
    let inherentCount = 0;
    let residualCount = 0;
    let critical = 0, high = 0, medium = 0, low = 0;
    let openRisks = 0;
    
    risks.forEach((risk: Risk) => {
      byCategory[risk.risk_category] = (byCategory[risk.risk_category] || 0) + 1;
      byStatus[risk.status] = (byStatus[risk.status] || 0) + 1;
      
      if (risk.inherent_score) {
        totalInherent += risk.inherent_score;
        inherentCount++;
        if (risk.inherent_score >= 20) critical++;
        else if (risk.inherent_score >= 12) high++;
        else if (risk.inherent_score >= 6) medium++;
        else low++;
      }
      
      if (risk.residual_score) {
        totalResidual += risk.residual_score;
        residualCount++;
      }
      
      if (risk.status === 'open') openRisks++;
    });
    
    return {
      total_risks: risks.length,
      by_category: byCategory,
      by_status: byStatus,
      by_score_range: { critical, high, medium, low },
      avg_inherent_score: inherentCount > 0 ? totalInherent / inherentCount : 0,
      avg_residual_score: residualCount > 0 ? totalResidual / residualCount : 0,
      open_risks: openRisks,
      risks_needing_review: 0,
    };
  }, [risks, dashboard]);

  const filteredRisks = useMemo(() => {
    if (!risks) return [];
    
    return risks.filter((risk: Risk) => {
      const matchesSearch = 
        risk.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        risk.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const effectiveCategory = inferEffectiveRiskCategory(risk);
      const riskRegisterType = risk.register_type;

      const matchesStatus = statusFilter === 'all' || risk.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || filterValuesMatch(effectiveCategory, categoryFilter);
      const matchesRegisterType = registerTypeFilter === 'all' || filterValuesMatch(riskRegisterType, registerTypeFilter);
      
      let matchesScore = true;
      const score = risk.inherent_score || 0;
      if (scoreFilter === 'critical') matchesScore = score >= 20;
      else if (scoreFilter === 'high') matchesScore = score >= 12 && score < 20;
      else if (scoreFilter === 'medium') matchesScore = score >= 6 && score < 12;
      else if (scoreFilter === 'low') matchesScore = score < 6;
      
      let matchesHeatmap = true;
      if (selectedHeatmapCell) {
        const likelihood = heatmapType === 'inherent' ? risk.inherent_likelihood : risk.residual_likelihood;
        const impact = heatmapType === 'inherent' ? risk.inherent_impact : risk.residual_impact;
        matchesHeatmap = likelihood === selectedHeatmapCell.l && impact === selectedHeatmapCell.i;
      }
      
      return matchesSearch && matchesStatus && matchesCategory && matchesRegisterType && matchesScore && matchesHeatmap;
    });
  }, [risks, searchTerm, statusFilter, categoryFilter, registerTypeFilter, scoreFilter, selectedHeatmapCell, heatmapType]);

  const availableCategoryOptions = useMemo(() => {
    const valuesByCanonical = new Map<string, string>();
    const baseCategories = isUBLFilterSelected
      ? RISK_CATEGORIES.filter((category) => UBL_ONLY_RISK_CATEGORIES.includes(category.value))
      : STANDARD_RISK_CATEGORIES;

    baseCategories.forEach((item) => {
      const canonical = canonicalFilterValue(item.value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, item.value);
      }
    });

    (risks || []).forEach((risk) => {
      if (isUBLFilterSelected && !isUBLRegisterTypeValue(risk.register_type)) {
        return;
      }
      const legacyCategory = (risk as Risk & { category?: string }).category;
      const value = (risk.risk_category || legacyCategory || '').trim();
      if (isUBLFilterSelected && !isUBLAllowedCategoryValue(value)) {
        return;
      }
      const canonical = canonicalFilterValue(value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, value);
      }
    });

    return Array.from(valuesByCanonical.values()).map((value) => ({
      value,
      label: value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (match) => match.toUpperCase()),
    }));
  }, [risks, isUBLFilterSelected]);

  const availableRegisterTypeOptions = useMemo(() => {
    const valuesByCanonical = new Map<string, string>();

    REGISTER_TYPES.forEach((item) => {
      const canonical = canonicalFilterValue(item.value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, item.value);
      }
    });

    (risks || []).forEach((risk) => {
      const value = (risk.register_type || '').trim();
      const canonical = canonicalFilterValue(value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, value);
      }
    });

    return Array.from(valuesByCanonical.values()).map((value) => ({
      value,
      label: isUBLRegisterTypeValue(value) ? 'Template' : value,
    }));
  }, [risks]);

  const toggleRiskRow = (riskId: number) => {
    setExpandedRiskRows((current) => ({
      ...current,
      [riskId]: !current[riskId],
    }));
  };

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load risks</p>
      </div>
    );
  }

  // Note: when isNcaFilterSelected is true, the standard view stays mounted —
  // the existing register_type filter naturally narrows the table to NCA-bridged
  // risks (register_type="NCA Template"). This keeps the heatmap, KPI cards,
  // search, filters, and table identical to the general view.

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      {/* View switcher — replaces the inline Dashboard button that used to
          live in the filters row. Lets the user flip between the flat
          register and the dashboard from a single dropdown that always
          reflects the current view. */}
      <div className="flex items-center justify-between gap-3">
        <RiskViewSwitcher active="list" />
      </div>

      {uploadResult && (
        <div className={`rounded-xl border p-4 ${uploadResult.errors.length > 0 ? 'border-red-500/50 bg-white' : 'border-green-500/50 bg-white'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              {uploadResult.errors.length > 0 ? (
                <AlertCircle className="h-5 w-5 text-red-700 mt-0.5" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-700 mt-0.5" />
              )}
              <div>
                <p className="font-medium text-slate-900">{uploadResult.message}</p>
                <div className="mt-1 flex gap-4 text-sm">
                  <span className="text-green-700">Created: {uploadResult.created}</span>
                  <span className="text-amber-700">Skipped: {uploadResult.skipped}</span>
                  {uploadResult.errors.length > 0 && (
                    <span className="text-red-700">Errors: {uploadResult.errors.length}</span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => setUploadResult(null)}
              className="text-slate-600 hover:text-slate-900"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Risk Heatmap</h2>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setHeatmapType('inherent');
                  setSelectedHeatmapCell(null);
                }}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  heatmapType === 'inherent'
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Inherent
              </button>
              <button
                onClick={() => {
                  setHeatmapType('residual');
                  setSelectedHeatmapCell(null);
                }}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  heatmapType === 'residual'
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Residual
              </button>
            </div>
          </div>

          <div className="flex">
            <div className="flex flex-col justify-between pr-2 text-xs text-slate-500">
              <span>5</span>
              <span>4</span>
              <span>3</span>
              <span>2</span>
              <span>1</span>
            </div>
            <div className="flex-1">
              <div className="grid grid-cols-5 gap-1">
                {[5, 4, 3, 2, 1].map((likelihood) =>
                  [1, 2, 3, 4, 5].map((impact) => {
                    const cell = heatmapMatrix[`${likelihood}-${impact}`];
                    const isSelected = selectedHeatmapCell?.l === likelihood && selectedHeatmapCell?.i === impact;
                    return (
                      <button
                        key={`${likelihood}-${impact}`}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedHeatmapCell(null);
                          } else {
                            setSelectedHeatmapCell({ l: likelihood, i: impact });
                          }
                        }}
                        className={`h-12 w-full flex items-center justify-center rounded text-xs font-medium transition-all ${
                          getHeatmapCellColor(likelihood, impact)
                        } ${isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-white' : ''}`}
                        title={`L${likelihood} x I${impact} = ${likelihood * impact}`}
                      >
                        {cell?.count > 0 && (
                          <span className="text-white">{cell.count}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>1</span>
                <span>Impact</span>
                <span>5</span>
              </div>
            </div>
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">
            Likelihood (Y-axis) x Impact (X-axis)
          </div>
          {selectedHeatmapCell && (
            <button
              onClick={() => setSelectedHeatmapCell(null)}
              className="mt-3 w-full rounded bg-slate-100 py-1 text-xs text-slate-700 hover:bg-slate-200"
            >
              Clear filter
            </button>
          )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="flex-1 min-w-[180px] sm:min-w-[260px] max-w-md">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search risks..."
              size="md"
            />
          </div>

          <MultiSelectDropdown
            title="Category"
            items={availableCategoryOptions.map((cat) => ({ value: cat.value, label: cat.label }))}
            selectedValues={categoryFilter === 'all' ? [] : [categoryFilter]}
            onApply={(values) => setCategoryFilter(values[0] || 'all')}
            multiSelect={false}
          />

          <MultiSelectDropdown
            title="Register Type"
            items={availableRegisterTypeOptions.map((type) => ({ value: type.value, label: type.label }))}
            selectedValues={registerTypeFilter === 'all' ? [] : [registerTypeFilter]}
            onApply={(values) => setRegisterTypeFilter(values[0] || 'all')}
            multiSelect={false}
          />

          <MultiSelectDropdown
            title="Score"
            items={[
              { value: 'critical', label: 'Critical (>=20)' },
              { value: 'high', label: 'High (12-19)' },
              { value: 'medium', label: 'Medium (6-11)' },
              { value: 'low', label: 'Low (<6)' },
            ]}
            selectedValues={scoreFilter === 'all' ? [] : [scoreFilter]}
            onApply={(values) => setScoreFilter((values[0] as ScoreFilter) || 'all')}
            multiSelect={false}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls"
            className="hidden"
          />
          {/* The Dashboard link previously lived here; it's now part of the
              view-switcher dropdown at the top of the page so users see one
              clear way to flip between the register and the dashboard. */}
          <button
            onClick={() => setIsUploadModalOpen(true)}
            disabled={isUploading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isUploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            import
          </button>
          <button
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Download size={16} />
            Template
          </button>
          {canCreate && (
            <button
              onClick={() => {
                // NCA filter active → open the NCA-specific add modal so the
                // form covers every NCA template column. Otherwise → open the
                // standard Add Risk slide-over.
                if (isNcaFilterSelected) {
                  setIsNcaAddOpen(true);
                } else {
                  setEditingRisk(null);
                  setIsModalOpen(true);
                }
              }}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium"
            >
              <Plus size={16} />
              {isNcaFilterSelected ? 'Add NCA Risk' : 'Add Risk'}
            </button>
          )}
        </div>
      </div>

      {/* NCA Template view — compact table with chevron-expandable detail rows.
          Shows all NCA risk template columns; data sourced from `template_fields`
          JSON populated by the bridge. Standard view stays mounted below. */}
      {isNcaFilterSelected ? (
        filteredRisks.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-slate-500" />
            <p className="mt-2 text-slate-600">No NCA risks found. Add one or upload the NCA template.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Risk ID</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider">Description</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Risk Area</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider">Threat</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Inherent Rating</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Treatment</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Residual Rating</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider">Owner</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRisks.map((risk) => {
                    const tf = ((risk as any).template_fields ?? {}) as Record<string, any>;
                    const expanded = !!expandedRiskRows[risk.id];
                    const toggle = () => setExpandedRiskRows((prev) => ({ ...prev, [risk.id]: !prev[risk.id] }));
                    const inherentRating = tf.inherent_rating_override
                      || (() => {
                          const s = (tf.inherent_likelihood || 0) * (tf.inherent_impact || 0);
                          if (!s) return null;
                          if (s >= 20) return 'Critical';
                          if (s >= 12) return 'High';
                          if (s >= 6) return 'Medium';
                          if (s >= 3) return 'Low';
                          return 'Very Low';
                        })();
                    const residualRating = (() => {
                      const s = (tf.residual_likelihood || 0) * (tf.residual_impact || 0);
                      if (!s) return null;
                      if (s >= 20) return 'Critical';
                      if (s >= 12) return 'High';
                      if (s >= 6) return 'Medium';
                      if (s >= 3) return 'Low';
                      return 'Very Low';
                    })();
                    const ratingClass = (r: string | null) => {
                      switch (r) {
                        case 'Critical':  return 'bg-rose-100 text-rose-700';
                        case 'High':      return 'bg-orange-100 text-orange-700';
                        case 'Medium':    return 'bg-amber-100 text-amber-700';
                        case 'Low':       return 'bg-green-100 text-green-700';
                        case 'Very Low':  return 'bg-gray-100 text-gray-600';
                        default:          return 'bg-gray-100 text-gray-500';
                      }
                    };
                    const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString() : '—');
                    const truncate = (s: any, n: number) =>
                      s ? (String(s).length > n ? String(s).slice(0, n) + '…' : String(s)) : '—';
                    const ownerName = risk.owner_name || tf.risk_owner;
                    const detailFields: Array<[string, any]> = [
                      ['Risk Identifier', tf.risk_identifier || `RISK-${risk.id}`],
                      ['Risk Area (Scope)', tf.risk_area],
                      ['Risk Owner', ownerName],
                      ['Date of Risk Identification', fmtDate(tf.date_identified)],
                      ['Description of the Risk', risk.description || tf.description],
                      ['Risk Cause', tf.risk_cause],
                      ['Threat', tf.threat],
                      ['Risk Analysis and Consequences', tf.risk_analysis],
                      ['Date of Risk Analysis', fmtDate(tf.date_analysis)],
                      ['Inherent Likelihood', tf.inherent_likelihood],
                      ['Inherent Impact', tf.inherent_impact],
                      ['Overall Inherent Rating', inherentRating],
                      ['Updated Inherent Rating (override)', tf.inherent_rating_override],
                      ['Type of Treatment Action', tf.treatment_type],
                      ['Risk Treatment Description', tf.treatment_description],
                      ['Deadline for Action', fmtDate(tf.treatment_deadline)],
                      ['Residual Risk Description', tf.residual_description],
                      ['Residual Likelihood', tf.residual_likelihood],
                      ['Residual Impact', tf.residual_impact],
                      ['Overall Residual Rating', residualRating],
                      ['Following Steps Description', tf.following_steps],
                      ['Last Evaluation Date', fmtDate(tf.last_evaluation_date)],
                      ['Comment', tf.comment],
                    ];
                    return (
                      <Fragment key={risk.id}>
                        <tr className="bg-white hover:bg-slate-50 transition-colors">
                          <td className="px-2 py-2 align-middle">
                            <button
                              onClick={toggle}
                              className="text-slate-400 hover:text-slate-700 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-slate-100"
                              aria-label={expanded ? 'Collapse' : 'Expand'}
                            >
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{tf.risk_identifier || `RISK-${risk.id}`}</td>
                          <td className="px-3 py-2 max-w-[280px]">
                            <Link href={`/risks/${risk.id}`} className="text-sm text-slate-900 font-medium hover:text-primary-600 line-clamp-1">
                              {truncate(risk.description || risk.title, 80)}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{tf.risk_area || '—'}</td>
                          <td className="px-3 py-2 text-slate-600 max-w-[180px] truncate" title={tf.threat || ''}>{tf.threat || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${ratingClass(inherentRating)}`}>
                              {inherentRating || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{tf.treatment_type || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${ratingClass(residualRating)}`}>
                              {residualRating || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{ownerName || <span className="italic text-slate-400">—</span>}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-0.5">
                              <Link
                                href={`/risks/${risk.id}`}
                                className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-600"
                                title="View Details"
                                aria-label="View Details"
                              >
                                <Eye size={16} />
                              </Link>
                              {canEdit && (
                                <button
                                  onClick={() => {
                                    // NCA row → open the NCA modal in edit mode
                                    // so all NCA template fields appear (the
                                    // general RiskModal only has a subset).
                                    setNcaEditBridgedId(risk.id);
                                    setIsNcaAddOpen(true);
                                  }}
                                  className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                                  title="Edit"
                                  aria-label="Edit"
                                >
                                  <Edit2 size={16} />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Delete risk "${risk.title || tf.risk_identifier}"? This cannot be undone.`)) {
                                      deleteMutation.mutate(risk.id);
                                    }
                                  }}
                                  disabled={deleteMutation.isPending}
                                  className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                                  title="Delete"
                                  aria-label="Delete"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-blue-50/30">
                            <td></td>
                            <td colSpan={9} className="px-4 py-3">
                              <div className="rounded-lg border border-blue-100 bg-white p-3">
                                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2">NCA Template Fields</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                                  {detailFields.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== '—').map(([label, value]) => (
                                    <div key={label}>
                                      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
                                      <p className="text-xs text-slate-800 whitespace-pre-wrap break-words">{String(value)}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
      <div className="space-y-3">
            {filteredRisks.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-2 text-slate-600">No risks found matching your criteria</p>
              </div>
            ) : (
              filteredRisks.map((risk) => {
                const categoryStyle = getCategoryStyle(inferEffectiveRiskCategory(risk));
                const statusStyle = getStatusStyle(risk.status);
                const scoreColor = getScoreColor(risk.inherent_score);
                const residualScoreColor = getScoreColor(risk.residual_score);
                const isExpanded = !!expandedRiskRows[risk.id];
                const shortTitle = compactTitle(risk.title, 6);
                const shortDescription = compactDescription(risk.description);
                
                return (
                  <div
                    key={risk.id}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 hover:border-slate-300"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <Link href={`/risks/${risk.id}`} className="block text-sm font-medium text-slate-900 hover:text-primary-500">
                          {shortTitle}
                        </Link>
                        {shortDescription && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{shortDescription}</p>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${categoryStyle.bgColor} ${categoryStyle.color}`}>
                            {categoryStyle.label}
                          </span>
                          {risk.risk_sub_category && (
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-slate-200/50 text-slate-700">
                              {risk.risk_sub_category}
                            </span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                            {statusStyle.label}
                          </span>
                          {risk.closure_status && (
                            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              risk.closure_status === 'closed'
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {risk.closure_status === 'closed' ? <Lock size={10} /> : <Unlock size={10} />}
                              {risk.closure_status === 'closed' ? 'Closed' : 'Pending Closure'}
                            </span>
                          )}
                          {risk.source_type && (
                            <SourceBadge
                              sourceType={risk.source_type}
                              sourceReference={risk.source_reference || null}
                            />
                          )}
                          {(risk.mitigation_actions?.length || 0) > 0 && (
                            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-500/20 text-indigo-400">
                              <ListTodo size={10} />
                              {risk.mitigation_actions?.length} Actions
                            </span>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] font-medium text-slate-500">Inherent (L / I / S)</p>
                              <p className="text-sm font-semibold text-slate-800">
                                {(risk.inherent_likelihood || '-')} / {(risk.inherent_impact || '-')} / {(risk.inherent_score || '-')}
                              </p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] font-medium text-slate-500">Residual (L / I / S)</p>
                              <p className="text-sm font-semibold text-slate-800">
                                {(risk.residual_likelihood || '-')} / {(risk.residual_impact || '-')} / {(risk.residual_score || '-')}
                              </p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] font-medium text-slate-500">Treatment</p>
                              <p className="line-clamp-2 text-sm text-slate-800">{risk.treatment_plan || 'No treatment plan'}</p>
                            </div>
                          </div>
                        )}
                        {isExpanded && risk.ubl_fields && typeof risk.ubl_fields === 'object' && (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                            {(() => {
                              const ubl = risk.ubl_fields as Record<string, unknown>;
                              const hasValue = (key: string) => toInputString(ubl[key]).trim().length > 0;
                              const topFields = ['risk_id'].filter(hasValue);
                              const sourceSheet = toInputString(ubl.source_sheet).trim();
                              const sections = getUblFieldSections(inferEffectiveRiskCategory(risk), sourceSheet);
                              const renderedKeys = new Set<string>();

                              return (
                                <div className="mt-2 space-y-3">
                                  {topFields.length > 0 && (
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                      {topFields.map((key) => {
                                        renderedKeys.add(key);
                                        return (
                                          <div key={key} className="rounded border border-slate-200 bg-white px-2 py-1">
                                            <p className="text-[11px] font-medium text-slate-500">{formatUblFieldLabel(key)}</p>
                                            <p className="text-xs text-slate-800 break-words whitespace-pre-wrap">{toInputString(ubl[key])}</p>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {sections.map((section) => {
                                    const sectionEntries = section.keys
                                      .filter((key) => hasValue(key) && !UBL_HIDDEN_DISPLAY_KEYS.has(key))
                                      .map((key) => {
                                        renderedKeys.add(key);
                                        return [key, ubl[key]] as const;
                                      });
                                    if (sectionEntries.length === 0) return null;
                                    return (
                                      <div key={section.id}>
                                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{section.title}</p>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                          {sectionEntries.map(([key, value]) => (
                                            <div key={key} className="rounded border border-slate-200 bg-white px-2 py-1">
                                              <p className="text-[11px] font-medium text-slate-500">{formatUblFieldLabel(key)}</p>
                                              <p className="text-xs text-slate-800 break-words whitespace-pre-wrap">{toInputString(value)}</p>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {Object.entries(ubl)
                                    .filter(
                                      ([key, value]) =>
                                        !renderedKeys.has(key) &&
                                        !UBL_HIDDEN_DISPLAY_KEYS.has(key) &&
                                        toInputString(value).trim().length > 0,
                                    )
                                    .length > 0 && (
                                    <div>
                                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Additional Fields</p>
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {Object.entries(ubl)
                                          .filter(
                                            ([key, value]) =>
                                              !renderedKeys.has(key) &&
                                              !UBL_HIDDEN_DISPLAY_KEYS.has(key) &&
                                              toInputString(value).trim().length > 0,
                                          )
                                          .map(([key, value]) => (
                                            <div key={key} className="rounded border border-slate-200 bg-white px-2 py-1">
                                              <p className="text-[11px] font-medium text-slate-500">{formatUblFieldLabel(key)}</p>
                                              <p className="text-xs text-slate-800 break-words whitespace-pre-wrap">{toInputString(value)}</p>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                      <div className="ml-4 flex items-center gap-2 shrink-0">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${scoreColor.bg} ${scoreColor.text}`}
                          title="Inherent score"
                        >
                          <span className="text-[10px] uppercase tracking-wide opacity-75">Inh</span>
                          <span className="font-semibold">{risk.inherent_score || '-'}</span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${residualScoreColor.bg} ${residualScoreColor.text}`}
                          title="Residual score"
                        >
                          <span className="text-[10px] uppercase tracking-wide opacity-75">Res</span>
                          <span className="font-semibold">{risk.residual_score || '-'}</span>
                        </span>
                        <div className="flex gap-0.5">
                          {canEdit && (
                            <button
                              onClick={() => {
                                setEditingRisk(risk);
                                setIsModalOpen(true);
                              }}
                              className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => {
                                if (confirm('Are you sure you want to delete this risk?')) {
                                  deleteMutation.mutate(risk.id);
                                }
                              }}
                              className="rounded p-1 text-slate-600 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleRiskRow(risk.id)}
                            className="rounded p-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
      )}

      {isModalOpen && (
        <RiskModal
          isOpen={isModalOpen}
          risk={editingRisk}
          onClose={() => {
            setIsModalOpen(false);
            setEditingRisk(null);
          }}
          onSubmit={async ({ riskData, linkedAssetIds }) => {
            if (editingRisk) {
              const updated = await updateMutation.mutateAsync({ id: editingRisk.id, data: riskData });
              const updatedRiskId = updated?.data?.id || editingRisk.id;
              if (linkedAssetIds?.length && updatedRiskId) {
                for (const assetId of linkedAssetIds) {
                  try {
                    await ermApi.risks.linkAsset(updatedRiskId, { asset_id: assetId });
                  } catch {
                  }
                }
              }
              return;
            }

            const created = await createMutation.mutateAsync(riskData);
            const createdRiskId = created?.data?.id;
            if (linkedAssetIds?.length && createdRiskId) {
              for (const assetId of linkedAssetIds) {
                try {
                  await ermApi.risks.linkAsset(createdRiskId, { asset_id: assetId });
                } catch {
                }
              }
              queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      <RightSlidePanel
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          setSelectedRegisterType('');
        }}
        title="Upload Risk Register"
        width="w-full max-w-[780px]"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">
              Risk Register Type (Optional)
            </label>
            <MultiSelectDropdown
              title="Risk Register Type"
              items={REGISTER_TYPES.filter(t => t.value).map(t => ({ value: t.value, label: t.label }))}
              selectedValues={selectedRegisterType ? [selectedRegisterType] : []}
              onApply={(vals) => setSelectedRegisterType(vals[0] || '')}
              multiSelect={false}
              triggerVariant="input"
              placeholder="Select Register Type"
              size="md"
            />
            <p className="mt-1 text-xs text-slate-500">
              Select a register type to categorize all risks in this file
            </p>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload size={18} />
                Select File to Upload
              </>
            )}
          </button>
        </div>
      </RightSlidePanel>

      <NcaRiskQuickAddModal
        isOpen={isNcaAddOpen}
        onClose={() => {
          setIsNcaAddOpen(false);
          setNcaEditBridgedId(null);
        }}
        editBridgedRiskId={ncaEditBridgedId}
        onCreated={(_entryId, bridgedRiskId) => {
          const wasEdit = ncaEditBridgedId !== null;
          setIsNcaAddOpen(false);
          setNcaEditBridgedId(null);
          queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
          queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
          queryClient.invalidateQueries({ queryKey: ['nca-risk-entries'] });
          // Only navigate to the detail page on CREATE — edit should stay on
          // the list so the user can keep working through other rows.
          if (!wasEdit && bridgedRiskId) {
            ncaAddRouter.push(`/risks/${bridgedRiskId}`);
          }
        }}
      />
    </div>
  );
}

interface User {
  id: number;
  email: string;
  full_name?: string;
}

interface AISuggestion {
  suggested_description: string;
  suggested_causes: string[];
  suggested_consequences: string[];
  suggested_recommendations?: string[];
  recommended_controls: Array<{
    control_id: number;
    control_name: string;
    control_code?: string;
    relevance: string;
    rationale: string;
    control_source?: string; // internal | parsed | framework
  }>;
  suggested_likelihood: number;
  suggested_impact: number;
  risk_treatment_options: string[];
}

interface RiskModalSubmitPayload {
  riskData: Partial<Risk>;
  linkedAssetIds?: number[];
}

function RiskModal({
  isOpen = true,
  risk,
  onClose,
  onSubmit,
  isLoading,
}: {
  isOpen?: boolean;
  risk: Risk | null;
  onClose: () => void;
  onSubmit: (payload: RiskModalSubmitPayload) => Promise<void> | void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: risk?.title || '',
    description: risk?.description || '',
    register_type: risk?.register_type || '',
    risk_category: risk?.risk_category || 'operational' as RiskCategory,
    risk_sub_category: risk?.risk_sub_category || toInputString((risk?.ubl_fields as Record<string, unknown> | undefined)?.sub_source_activity || ''),
    business_owner_id: risk?.business_owner_id || undefined as number | undefined,
    affected_department_ids: risk?.affected_department_ids || [] as number[],
    // Owning team (admin/teams). Backend resolves this to a real
    // BusinessUnit row (auto-mirrored by name) and stores it on the
    // risk's business_unit_id column so existing joins keep working.
    team_id: ((risk as unknown as { team_id?: number; business_unit_id?: number } | null)?.team_id
      ?? (risk as unknown as { business_unit_id?: number } | null)?.business_unit_id
      ?? undefined) as number | undefined,
    status: risk?.status || 'open' as RiskStatus,
    inherent_likelihood: risk?.inherent_likelihood || 3,
    inherent_impact: risk?.inherent_impact || 3,
    residual_likelihood: risk?.residual_likelihood || 2,
    residual_impact: risk?.residual_impact || 2,
    treatment_plan: risk?.treatment_plan || '',
    root_cause: (risk as unknown as { root_cause?: string } | null)?.root_cause || '',
    recommendations: (risk as unknown as { recommendations?: string } | null)?.recommendations || '',
  });
  const [assetSearch, setAssetSearch] = useState('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>(
    ((risk as unknown as { linked_assets?: Array<{ asset_id?: number; id?: number }> } | null)?.linked_assets || [])
      .map((asset) => Number(asset.asset_id ?? asset.id))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const [ublFields, setUblFields] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    UBL_FIELD_DEFS.forEach((field) => {
      defaults[field.key] = '';
    });

    const raw = risk?.ubl_fields;
    if (raw && typeof raw === 'object') {
      Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
        defaults[key] = toInputString(value);
      });
    }
    return defaults;
  });

  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion | null>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [isGeneratingTreatment, setIsGeneratingTreatment] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      try {
        const response = await adminApi.getUsers();
        return (response.data || []).map((user: any) => ({
          id: user.id,
          email: user.email,
          full_name:
            user.full_name ||
            user.name ||
            [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
            user.email,
        })) as User[];
      } catch {
        return [];
      }
    },
  });

  const { data: assets } = useQuery({
    queryKey: ['erm-assets-select-options'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return (response.data || []) as ITAsset[];
    },
  });

  // Active teams from admin/teams. These now drive the "Assigned Team"
  // and "Affected Departments" pickers — replacing the hardcoded list
  // that the tenant couldn't edit. The same Team list is used for RCSA
  // campaign seeding, so a risk assigned to a team here matches the
  // assessment row that team will fill out.
  const { data: teams } = useQuery({
    queryKey: ['risk-modal-teams'],
    queryFn: async () => {
      try {
        const response = await teamsApi.list(false);
        return response.data || [];
      } catch {
        return [];
      }
    },
    staleTime: 60 * 1000,
  });

  const filteredAssets = useMemo(() => {
    const allAssets = assets || [];
    const term = assetSearch.trim().toLowerCase();
    if (!term) return allAssets;
    return allAssets.filter((asset) => {
      const name = (asset.name || '').toLowerCase();
      const assetType = (asset.asset_type || '').toLowerCase();
      const owner = (asset.owner_name || '').toLowerCase();
      return (
        name.includes(term) ||
        assetType.includes(term) ||
        owner.includes(term) ||
        String(asset.id).includes(term)
      );
    });
  }, [assets, assetSearch]);

  const selectedAssets = useMemo(() => {
    const byId = new Map((assets || []).map((asset) => [asset.id, asset]));
    return selectedAssetIds
      .map((id) => byId.get(id))
      .filter((asset): asset is ITAsset => !!asset);
  }, [assets, selectedAssetIds]);

  const isUBLTemplateSelected = canonicalFilterValue(formData.register_type) === canonicalFilterValue(UBL_TEMPLATE_REGISTER_TYPE);
  const categoryOptions = isUBLTemplateSelected
    ? RISK_CATEGORIES.filter((category) => UBL_ONLY_RISK_CATEGORIES.includes(category.value))
    : STANDARD_RISK_CATEGORIES;
  const extraUblFieldKeys = useMemo(() => {
    return Object.keys(ublFields).filter(
      (key) =>
        !UBL_FIELD_KEY_SET.has(key) &&
        !UBL_NON_EDITABLE_FIELD_KEYS.has(key) &&
        !UBL_HIDDEN_DISPLAY_KEYS.has(key),
    );
  }, [ublFields]);
  const systemUblRiskId = useMemo(() => {
    const fromForm = (ublFields.risk_id || '').trim();
    if (fromForm) return fromForm;
    const raw = risk?.ubl_fields as Record<string, unknown> | undefined;
    const fromRisk = toInputString(raw?.risk_id).trim();
    return fromRisk || '';
  }, [ublFields.risk_id, risk?.ubl_fields]);
  const sourceSheetValue = useMemo(() => {
    const raw = risk?.ubl_fields as Record<string, unknown> | undefined;
    return toInputString(raw?.source_sheet).trim();
  }, [risk?.ubl_fields]);
  const activeUblSections = useMemo(
    () => getUblFieldSections(formData.risk_category, sourceSheetValue),
    [formData.risk_category, sourceSheetValue],
  );
  const ublSubCategorySuggestions = useMemo(() => {
    const key = UBL_ONLY_RISK_CATEGORIES.includes(formData.risk_category) ? formData.risk_category : 'technology';
    return UBL_SUB_CATEGORY_SUGGESTIONS[key] || [];
  }, [formData.risk_category]);

  const subCategories = SUB_CATEGORIES_BY_CATEGORY[formData.risk_category] || [];

  const handleCategoryChange = (newCategory: RiskCategory) => {
    setFormData({ 
      ...formData, 
      risk_category: newCategory,
      risk_sub_category: ''
    });
  };

  const handleRegisterTypeChange = (newRegisterType: string) => {
    const isUBL = canonicalFilterValue(newRegisterType) === canonicalFilterValue(UBL_TEMPLATE_REGISTER_TYPE);
    let nextCategory = formData.risk_category;
    if (isUBL && !UBL_ONLY_RISK_CATEGORIES.includes(nextCategory)) {
      nextCategory = 'technology';
    }
    const nextSubCategory = isUBL
      ? formData.risk_sub_category
      : (SUB_CATEGORIES_BY_CATEGORY[nextCategory]?.includes(formData.risk_sub_category) ? formData.risk_sub_category : '');
    setFormData({
      ...formData,
      register_type: newRegisterType,
      risk_category: nextCategory,
      risk_sub_category: nextSubCategory,
    });
  };

  const handleDepartmentToggle = (deptId: number) => {
    const current = formData.affected_department_ids;
    if (current.includes(deptId)) {
      setFormData({ ...formData, affected_department_ids: current.filter(id => id !== deptId) });
    } else {
      setFormData({ ...formData, affected_department_ids: [...current, deptId] });
    }
  };

  const toggleAssetSelection = (assetId: number) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
    );
  };

  const handleUBLFieldChange = (key: string, value: string) => {
    setUblFields((current) => ({
      ...current,
      [key]: value,
    }));

    if (!isUBLTemplateSelected) return;
    if (key === 'risk_category_raw') {
      const mappedCategory = mapUblRawCategoryToRiskCategory(value);
      if (mappedCategory) {
        setFormData((current) => ({ ...current, risk_category: mappedCategory }));
      }
    }
  };

  const handleGetAISuggestions = async () => {
    if (formData.title.trim().length < 3) {
      setAiError('Please enter at least 3 characters for the risk title');
      return;
    }
    
    setIsLoadingAI(true);
    setAiError(null);
    
    try {
      const response = await ermApi.risks.getAISuggestions({
        name: formData.title,
        category: formData.risk_category,
        sub_category: formData.risk_sub_category || undefined,
        description: formData.description || undefined,
      });
      setAiSuggestions(response.data);
      setShowSuggestions(true);
    } catch (err) {
      console.error('AI suggestion error:', err);
      setAiError('Failed to get AI suggestions. Please try again.');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const applyDescription = () => {
    if (aiSuggestions?.suggested_description) {
      setFormData({ ...formData, description: aiSuggestions.suggested_description });
    }
  };

  // Save the AI-suggested root causes / recommendations into their OWN fields
  // (the user reviews them in the panel, then clicks to save).
  const applyRootCauses = () => {
    const causes = aiSuggestions?.suggested_causes || [];
    if (causes.length) {
      setFormData((prev) => ({ ...prev, root_cause: causes.map((c) => `• ${c}`).join('\n') }));
    }
  };
  const applyRecommendations = () => {
    const recs = aiSuggestions?.suggested_recommendations || [];
    if (recs.length) {
      setFormData((prev) => ({ ...prev, recommendations: recs.map((r) => `• ${r}`).join('\n') }));
    }
  };

  const applyLikelihoodImpact = () => {
    if (aiSuggestions) {
      setFormData({
        ...formData,
        inherent_likelihood: aiSuggestions.suggested_likelihood,
        inherent_impact: aiSuggestions.suggested_impact,
      });
    }
  };

  const appendCauseToDescription = (cause: string) => {
    const causesSection = formData.description.includes('Root Causes:') 
      ? formData.description 
      : formData.description + (formData.description ? '\n\n' : '') + 'Root Causes:\n';
    setFormData({ ...formData, description: causesSection + `â€¢ ${cause}\n` });
  };

  const appendConsequenceToDescription = (consequence: string) => {
    const consequenceSection = formData.description.includes('Potential Consequences:')
      ? formData.description
      : formData.description + (formData.description ? '\n\n' : '') + 'Potential Consequences:\n';
    setFormData({ ...formData, description: consequenceSection + `â€¢ ${consequence}\n` });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedUblFields = Object.entries(ublFields).reduce<Record<string, string>>((acc, [key, value]) => {
      if (UBL_NON_EDITABLE_FIELD_KEYS.has(key) || UBL_PLATFORM_DUPLICATE_KEYS.has(key)) return acc;
      const cleaned = (value || '').trim();
      if (cleaned) acc[key] = cleaned;
      return acc;
    }, {});
    const derivedSubCategory = (formData.risk_sub_category || '').trim();
    if (isUBLTemplateSelected) {
      cleanedUblFields.risk_category_raw = getRiskCategoryLabel(formData.risk_category);
      if (derivedSubCategory) {
        cleanedUblFields.sub_source_activity = derivedSubCategory;
      }
    }

    await onSubmit({
      riskData: {
        ...formData,
        risk_sub_category: derivedSubCategory,
        inherent_score: formData.inherent_likelihood * formData.inherent_impact,
        residual_score: formData.residual_likelihood * formData.residual_impact,
        ubl_fields: isUBLTemplateSelected ? cleanedUblFields : undefined,
      },
      linkedAssetIds: selectedAssetIds,
    });
  };

  const renderUblInput = (field: UBLFieldDef) => {
    const value = ublFields[field.key] || '';
    const listId = `ubl-${field.key}-options`;

    if (field.input === 'textarea') {
      return (
        <textarea
          value={value}
          onChange={(e) => handleUBLFieldChange(field.key, e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
        />
      );
    }
    if (field.input === 'select') {
      return (
        <select
          value={value}
          onChange={(e) => handleUBLFieldChange(field.key, e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
        >
          {(field.options || ['']).map((option) => (
            <option key={option || 'empty'} value={option}>{option || 'Select...'}</option>
          ))}
        </select>
      );
    }
    if (field.input === 'datalist') {
      return (
        <>
          <input
            type="text"
            list={listId}
            value={value}
            onChange={(e) => handleUBLFieldChange(field.key, e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
          />
          <datalist id={listId}>
            {(field.suggestions || []).map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </>
      );
    }

    return (
      <input
        type={field.input}
        value={value}
        onChange={(e) => handleUBLFieldChange(field.key, e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
        placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
      />
    );
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={risk ? 'Edit Risk' : 'Create Risk'}
      width="w-full max-w-[780px]"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="risk-modal-form"
            disabled={isLoading}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              risk ? 'Update' : 'Create'
            )}
          </button>
        </div>
      }
    >
      <form id="risk-modal-form" onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Title *</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
                placeholder="Enter risk title..."
              />
              <button
                type="button"
                onClick={handleGetAISuggestions}
                disabled={isLoadingAI || formData.title.trim().length < 3}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-medium text-slate-900 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLoadingAI ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                AI Assist
              </button>
            </div>
            {aiError && (
              <p className="mt-1 text-xs text-red-400">{aiError}</p>
            )}
          </div>

          {aiSuggestions && (
            <div className="rounded-xl border-2 border-transparent bg-gradient-to-r from-purple-500/20 to-blue-500/20 p-[2px]">
              <div className="rounded-[10px] bg-white p-4">
                <button
                  type="button"
                  onClick={() => setShowSuggestions(!showSuggestions)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium text-slate-900">AI Suggestions</span>
                  </div>
                  {showSuggestions ? (
                    <ChevronUp className="h-4 w-4 text-slate-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  )}
                </button>
                
                {showSuggestions && (
                  <div className="mt-4 space-y-4">
                    {risk?.id && (
                      <AiRecommendationSaver
                        module="erm_risk_suggestion"
                        recommendationType="ai_suggestion"
                        entityType="risk"
                        entityId={risk.id}
                        title={`AI suggestion · ${formData.title || 'risk'}`}
                        output={aiSuggestions as unknown as Record<string, unknown>}
                      />
                    )}
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Suggested Description</h4>
                        <button
                          type="button"
                          onClick={applyDescription}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 font-medium"
                        >
                          <Check className="h-3 w-3" />
                          Use this
                        </button>
                      </div>
                      <p className="mt-1 text-sm text-slate-700 bg-slate-100/50 rounded-lg p-3">
                        {aiSuggestions.suggested_description}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Root Causes</h4>
                          <button
                            type="button"
                            onClick={applyRootCauses}
                            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          >
                            <Check className="h-3 w-3" /> Save to field
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {aiSuggestions.suggested_causes.map((cause, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => appendCauseToDescription(cause)}
                              title="Append to description"
                              className="rounded-full bg-red-100 px-2.5 py-1 text-xs text-red-700 hover:bg-red-200 transition-colors border border-red-200"
                            >
                              + {cause}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Consequences</h4>
                        <div className="flex flex-wrap gap-1">
                          {aiSuggestions.suggested_consequences.map((consequence, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => appendConsequenceToDescription(consequence)}
                              className="rounded-full bg-orange-100 px-2.5 py-1 text-xs text-orange-700 hover:bg-orange-200 transition-colors border border-orange-200"
                            >
                              + {consequence}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {Array.isArray(aiSuggestions.suggested_recommendations) && aiSuggestions.suggested_recommendations.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Recommendations</h4>
                          <button
                            type="button"
                            onClick={applyRecommendations}
                            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          >
                            <Check className="h-3 w-3" /> Save to field
                          </button>
                        </div>
                        <ul className="space-y-1">
                          {aiSuggestions.suggested_recommendations.map((rec, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                              <span className="mt-0.5 text-emerald-500">•</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Suggested Risk Rating</h4>
                        <button
                          type="button"
                          onClick={applyLikelihoodImpact}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 font-medium"
                        >
                          <Check className="h-3 w-3" />
                          Apply
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">Likelihood:</span>
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-sm font-medium text-blue-700">
                            {aiSuggestions.suggested_likelihood}/5
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">Impact:</span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-700">
                            {aiSuggestions.suggested_impact}/5
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">Score:</span>
                          <span className={`rounded px-2 py-0.5 text-sm font-medium ${getScoreColor(aiSuggestions.suggested_likelihood * aiSuggestions.suggested_impact).bg} ${getScoreColor(aiSuggestions.suggested_likelihood * aiSuggestions.suggested_impact).text}`}>
                            {aiSuggestions.suggested_likelihood * aiSuggestions.suggested_impact}
                          </span>
                        </div>
                      </div>
                    </div>

                    {aiSuggestions.recommended_controls.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Recommended Controls</h4>
                        <div className="space-y-2">
                          {aiSuggestions.recommended_controls.map((control) => (
                            <div
                              key={control.control_id}
                              className="flex items-start gap-3 rounded-lg bg-slate-100/50 p-3"
                            >
                              <Shield className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-900 truncate">
                                    {control.control_name}
                                  </span>
                                  {control.control_code && (
                                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
                                      {control.control_code}
                                    </span>
                                  )}
                                  {control.control_source && (
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                      control.control_source === 'internal'
                                        ? 'bg-indigo-100 text-indigo-700'
                                        : 'bg-sky-100 text-sky-700'
                                    }`}>
                                      {control.control_source === 'internal' ? 'Internal' : 'Framework'}
                                    </span>
                                  )}
                                  <span className={`rounded px-1.5 py-0.5 text-xs ${
                                    control.relevance === 'high'
                                      ? 'bg-green-100 text-green-700'
                                      : control.relevance === 'medium'
                                      ? 'bg-yellow-100 text-yellow-700'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {control.relevance}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-600">{control.rationale}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Treatment Options</h4>
                      <div className="flex flex-wrap gap-2">
                        {aiSuggestions.risk_treatment_options.map((option, idx) => (
                          <span
                            key={idx}
                            className="rounded-full bg-primary-100 px-3 py-1 text-xs text-primary-700"
                          >
                            {option}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={3}
              placeholder="Describe the risk..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Register Type</label>
            <MultiSelectDropdown
              title="Register Type"
              items={REGISTER_TYPES.filter(t => t.value).map(t => ({ value: t.value, label: t.label }))}
              selectedValues={formData.register_type ? [formData.register_type] : []}
              onApply={(vals) => handleRegisterTypeChange(vals[0] || '')}
              multiSelect={false}
              triggerVariant="input"
              placeholder="Select Register Type"
              size="md"
            />
          </div>

          {isUBLTemplateSelected && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-800">Register Fields</h3>
              <p className="mt-1 text-xs text-slate-500">
                Fill relevant columns from the selected register type. Risk ID is system generated.
              </p>
              {systemUblRiskId && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-medium text-slate-500">System Risk ID</p>
                  <p className="text-sm font-semibold text-slate-800">{systemUblRiskId}</p>
                </div>
              )}
              <div className="mt-3 space-y-4">
                {activeUblSections.map((section) => {
                  const sectionFields = section.keys
                    .map((key) => UBL_FIELD_DEF_MAP.get(key))
                    .filter((field): field is UBLFieldDef => !!field);
                  if (sectionFields.length === 0) return null;
                  return (
                    <div key={section.id}>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{section.title}</h4>
                      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {sectionFields.map((field) => (
                          <div key={field.key}>
                            <label className="block text-xs text-slate-600">{field.label}</label>
                            {renderUblInput(field)}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {extraUblFieldKeys.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Additional Fields</h4>
                    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {extraUblFieldKeys.map((key) => (
                        <div key={key}>
                          <label className="block text-xs text-slate-600">{formatUblFieldLabel(key)}</label>
                          <input
                            type="text"
                            value={ublFields[key] || ''}
                            onChange={(e) => handleUBLFieldChange(key, e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">
                {isUBLTemplateSelected ? 'Category (Risk Category)' : 'Category'}
              </label>
              <MultiSelectDropdown
                title="Category"
                items={categoryOptions.map((cat) => ({ value: cat.value, label: cat.label }))}
                selectedValues={formData.risk_category ? [formData.risk_category] : []}
                onApply={(vals) => handleCategoryChange((vals[0] || categoryOptions[0]?.value) as RiskCategory)}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select Category"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">
                {isUBLTemplateSelected ? 'Sub-Category (Sub-Source / Activity)' : 'Sub-Category'}
              </label>
              {isUBLTemplateSelected ? (
                <>
                  <input
                    type="text"
                    list="ubl-sub-source-options"
                    value={formData.risk_sub_category}
                    onChange={(e) => setFormData({ ...formData, risk_sub_category: e.target.value.slice(0, 100) })}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Enter sub-source / activity..."
                  />
                  <datalist id="ubl-sub-source-options">
                    {ublSubCategorySuggestions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </>
              ) : (
                <MultiSelectDropdown
                  title="Sub-Category"
                  items={subCategories.map((sub) => ({ value: sub, label: sub }))}
                  selectedValues={formData.risk_sub_category ? [formData.risk_sub_category] : []}
                  onApply={(vals) => setFormData({ ...formData, risk_sub_category: vals[0] || '' })}
                  multiSelect={false}
                  triggerVariant="input"
                  placeholder="Select Sub-Category"
                  size="md"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Status</label>
              <MultiSelectDropdown
                title="Status"
                items={RISK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                selectedValues={formData.status ? [formData.status] : []}
                onApply={(vals) => setFormData({ ...formData, status: (vals[0] || RISK_STATUSES[0].value) as RiskStatus })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select Status"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Business Owner</label>
              <MultiSelectDropdown
                title="Business Owner"
                items={(users || []).map((user) => ({
                  value: String(user.id),
                  label: user.full_name || user.email,
                  subLabel: user.full_name ? user.email : undefined,
                }))}
                selectedValues={formData.business_owner_id ? [String(formData.business_owner_id)] : []}
                onApply={(vals) => setFormData({ ...formData, business_owner_id: vals[0] ? Number(vals[0]) : undefined })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select Owner"
                size="md"
                forceSearch
              />
            </div>
          </div>

          {/* Assigned team / department picker — backed by admin/teams.
              When the risk is saved the backend resolves this team_id to
              a BusinessUnit row (creating one named after the team if
              none exists) and stores it on the risk's business_unit_id.
              That same business_unit_id is what RCSA assessments and the
              dashboard's BU-progress panel are keyed on, so a risk
              assigned here lands in the right team's scope automatically. */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">
              Assigned Team / Department
              <span className="ml-1 text-xs font-normal text-gray-500">(defines who owns and reviews this risk)</span>
            </label>
            <MultiSelectDropdown
              title="Assigned Team"
              items={(teams || []).map((t: any) => ({
                value: String(t.id),
                label: t.name,
                subLabel: t.description || undefined,
              }))}
              selectedValues={formData.team_id ? [String(formData.team_id)] : []}
              onApply={(vals) => setFormData({ ...formData, team_id: vals[0] ? Number(vals[0]) : undefined })}
              multiSelect={false}
              triggerVariant="input"
              placeholder={(teams || []).length === 0 ? 'No teams configured yet — create one in Admin → Teams' : 'Select a team / department'}
              size="md"
              forceSearch
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Linked Assets (Optional)</label>
            <div className="rounded-lg border border-gray-300 bg-white p-2">
              <SearchInput
                value={assetSearch}
                onChange={setAssetSearch}
                placeholder="Search assets by name..."
                size="md"
              />
              <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white">
                {filteredAssets.length === 0 ? (
                  <p className="px-3 py-1.5 text-sm text-slate-600">No assets found</p>
                ) : (
                  filteredAssets.map((asset) => {
                    const checked = selectedAssetIds.includes(asset.id);
                    return (
                      <label
                        key={asset.id}
                        className="flex cursor-pointer items-center gap-2 border-b border-slate-100 py-1.5 px-3 text-sm text-slate-900 last:border-b-0 hover:bg-slate-100"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAssetSelection(asset.id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className="truncate">{asset.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
              {selectedAssets.length > 0 && (
                <p className="mt-2 text-xs text-slate-600">
                  Selected: {selectedAssets.map((asset) => asset.name).join(', ')}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Affected Departments</label>
            {/* Previously a hardcoded list (IT/Finance/Operations/...) that
                tenants couldn't edit. Now sourced from admin/teams so the
                same definitions flow through the risk register, RCSA
                campaigns, and dashboard BU progress. Stores team ids in
                affected_department_ids (the column itself is just a JSON
                int-list — semantics moved from a fake DEPARTMENTS index
                to real Team primary keys). */}
            <div className="flex flex-wrap gap-2">
              {(teams || []).length === 0 && (
                <p className="text-xs text-slate-500 italic">
                  No teams configured yet. Add them in Admin → Teams.
                </p>
              )}
              {(teams || []).map((dept: any) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => handleDepartmentToggle(dept.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    formData.affected_department_ids.includes(dept.id)
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-500'
                  }`}
                >
                  {dept.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Inherent Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_likelihood}
                onChange={(e) => setFormData({ ...formData, inherent_likelihood: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Inherent Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_impact}
                onChange={(e) => setFormData({ ...formData, inherent_impact: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Residual Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_likelihood}
                onChange={(e) => setFormData({ ...formData, residual_likelihood: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Residual Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_impact}
                onChange={(e) => setFormData({ ...formData, residual_impact: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-800">Treatment Plan</label>
              {risk && (
                <button
                  type="button"
                  onClick={async () => {
                    setIsGeneratingTreatment(true);
                    try {
                      const response = await ermApi.risks.generateTreatmentPlan(risk.id);
                      setFormData(prev => ({ ...prev, treatment_plan: response.data.treatment_plan }));
                    } catch {
                      setAiError('Failed to generate treatment plan');
                    } finally {
                      setIsGeneratingTreatment(false);
                    }
                  }}
                  disabled={isGeneratingTreatment}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-medium text-slate-900 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 transition-all"
                >
                  {isGeneratingTreatment ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  AI Generate Treatment Plan
                </button>
              )}
            </div>
            <textarea
              value={formData.treatment_plan}
              onChange={(e) => setFormData({ ...formData, treatment_plan: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={formData.treatment_plan.length > 200 ? 8 : 2}
            />
          </div>

          {/* Root Cause + Recommendations — reviewable AI-assist fields, also
              free-text editable. "Save to field" in the AI panel fills these. */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Root Cause</label>
            <textarea
              value={formData.root_cause}
              onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={formData.root_cause.length > 200 ? 6 : 2}
              placeholder="Why this risk exists (use AI Assist → Root Causes → Save to field, or write your own)…"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Recommendations</label>
            <textarea
              value={formData.recommendations}
              onChange={(e) => setFormData({ ...formData, recommendations: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={formData.recommendations.length > 200 ? 6 : 2}
              placeholder="Recommended actions to reduce this risk (AI Assist → Recommendations → Save to field, or write your own)…"
            />
          </div>

      </form>
    </RightSlidePanel>
  );
}

