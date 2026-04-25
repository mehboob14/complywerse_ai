'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { adminApi, assetsApi, ermApi } from '@/lib/api';
import { ITAsset, Risk, RiskCategory, RiskStatus, RiskDashboard, HeatmapCell } from '@/types';
import { 
  AlertTriangle, 
  Loader2, 
  AlertCircle, 
  Search, 
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
  ChevronUp,
  Check,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

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

const REGISTER_TYPES = [
  { value: UBL_TEMPLATE_REGISTER_TYPE, label: 'Template' },
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
  if (score >= 20) return 'bg-red-600/80 hover:bg-red-600';
  if (score >= 15) return 'bg-red-500/60 hover:bg-red-500/80';
  if (score >= 12) return 'bg-orange-500/60 hover:bg-orange-500/80';
  if (score >= 8) return 'bg-yellow-500/60 hover:bg-yellow-500/80';
  if (score >= 4) return 'bg-yellow-400/40 hover:bg-yellow-400/60';
  return 'bg-green-500/40 hover:bg-green-500/60';
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
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedRegisterType, setSelectedRegisterType] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<{ message: string; created: number; skipped: number; errors: string[] } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [expandedRiskRows, setExpandedRiskRows] = useState<Record<number, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const isUBLFilterSelected = isUBLRegisterTypeValue(registerTypeFilter);

  useEffect(() => {
    if (!isUBLFilterSelected) return;
    if (categoryFilter === 'all') return;
    if (!isUBLAllowedCategoryValue(categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [isUBLFilterSelected, categoryFilter]);

  const { data: risks, isLoading, error } = useQuery({
    queryKey: ['erm-risks'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

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
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
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

  return (
    <div className="space-y-6">
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Total Risks</p>
              <p className="text-2xl font-bold text-slate-900">{computedDashboard?.total_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <Shield className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Open Risks</p>
              <p className="text-2xl font-bold text-slate-900">{computedDashboard?.open_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2">
              <TrendingUp className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Avg Inherent</p>
              <p className="text-2xl font-bold text-slate-900">
                {(computedDashboard?.avg_inherent_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <TrendingDown className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Avg Residual</p>
              <p className="text-2xl font-bold text-slate-900">
                {(computedDashboard?.avg_residual_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Risk Heatmap</h2>
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
              <div className="grid grid-cols-5 gap-1" style={{ height: '180px' }}>
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
                        className={`flex items-center justify-center rounded text-xs font-medium transition-all ${
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

      <div className="flex flex-wrap items-center gap-3 ">
           <div className="relative w-[20%]  xl:flex-none">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search risks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
        >
          <option value="all">All Categories</option>
          {availableCategoryOptions.map((cat) => (
            <option key={cat.value} value={cat.value}>{cat.label}</option>
          ))}
        </select>

        <select
          value={registerTypeFilter}
          onChange={(e) => setRegisterTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
        >
          <option value="all">Register Types</option>
          {availableRegisterTypeOptions.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>

        {/* <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RiskStatus | 'all')}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
        >
          <option value="all">All Statuses</option>
          {RISK_STATUSES.map(status => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </select> */}

        <select
          value={scoreFilter}
          onChange={(e) => setScoreFilter(e.target.value as ScoreFilter)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
        >
          <option value="all">All Scores</option>
          <option value="critical">Critical (â‰¥20)</option>
          <option value="high">High (12-19)</option>
          <option value="medium">Medium (6-11)</option>
          <option value="low">Low (&lt;6)</option>
        </select>

        <div className="ml-auto flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls"
            className="hidden"
          />
          <button
            onClick={() => setIsUploadModalOpen(true)}
            disabled={isUploading}
            className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 font-medium text-slate-900 hover:bg-slate-200 disabled:opacity-50"
          >
            {isUploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Upload size={18} />
            )}
            import
          </button>
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-medium text-slate-900 border border-slate-300 hover:bg-slate-50"
          >
            <Download size={18} />
            Template
          </button>
          {canCreate && (
            <button
              onClick={() => {
                setEditingRisk(null);
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
            >
              <Plus size={18} />
              Add Risk
            </button>
          )}
        </div>
      </div>

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
                    className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <Link href={`/risks/${risk.id}`} className="text-2xl font-semibold text-slate-900 hover:text-primary-500">
                          {shortTitle}
                        </Link>
                        {shortDescription && (
                          <p className="mt-1 line-clamp-1 text-sm text-slate-700">{shortDescription}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${categoryStyle.bgColor} ${categoryStyle.color}`}>
                            {categoryStyle.label}
                          </span>
                          {risk.risk_sub_category && (
                            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-200/50 text-slate-700">
                              {risk.risk_sub_category}
                            </span>
                          )}
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                            {statusStyle.label}
                          </span>
                          {risk.closure_status && (
                            <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              risk.closure_status === 'closed' 
                                ? 'bg-slate-100 text-slate-700' 
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {risk.closure_status === 'closed' ? <Lock size={10} /> : <Unlock size={10} />}
                              {risk.closure_status === 'closed' ? 'Closed' : 'Pending Closure'}
                            </span>
                          )}
                          {(risk.mitigation_actions?.length || 0) > 0 && (
                            <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-500/20 text-indigo-400">
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
                      <div className="ml-4 flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Inherent</p>
                          <p className={`text-lg font-bold ${scoreColor.text}`}>
                            {risk.inherent_score || '-'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Residual</p>
                          <p className={`text-lg font-bold ${residualScoreColor.text}`}>
                            {risk.residual_score || '-'}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          {canEdit && (
                            <button
                              onClick={() => {
                                setEditingRisk(risk);
                                setIsModalOpen(true);
                              }}
                              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                              className="rounded p-1.5 text-slate-600 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleRiskRow(risk.id)}
                            className="rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
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

      {isModalOpen && (
        <RiskModal
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

      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Upload Risk Register</h2>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setSelectedRegisterType('');
                }}
                className="text-slate-600 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Risk Register Type (Optional)
                </label>
                <select
                  value={selectedRegisterType}
                  onChange={(e) => setSelectedRegisterType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                >
                  <option value="">None (No Register Type)</option>
                  {REGISTER_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
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
          </div>
        </div>
      )}
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
  recommended_controls: Array<{
    control_id: number;
    control_name: string;
    control_code?: string;
    relevance: string;
    rationale: string;
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
  risk,
  onClose,
  onSubmit,
  isLoading,
}: {
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
    status: risk?.status || 'open' as RiskStatus,
    inherent_likelihood: risk?.inherent_likelihood || 3,
    inherent_impact: risk?.inherent_impact || 3,
    residual_likelihood: risk?.residual_likelihood || 2,
    residual_impact: risk?.residual_impact || 2,
    treatment_plan: risk?.treatment_plan || '',
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
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close risk panel" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 z-10 flex h-full w-full max-w-[1400px] flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[94vw] lg:w-[86vw] xl:w-[80vw] 2xl:w-[72vw]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{risk ? 'Edit Risk' : 'Create Risk'}</h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-600">Title</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="flex-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
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
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Root Causes</h4>
                        <div className="flex flex-wrap gap-1">
                          {aiSuggestions.suggested_causes.map((cause, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => appendCauseToDescription(cause)}
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
            <label className="block text-sm text-slate-600">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              rows={3}
              placeholder="Describe the risk..."
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600">Register Type</label>
            <select
              value={formData.register_type}
              onChange={(e) => handleRegisterTypeChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option value="">Select register type...</option>
              {REGISTER_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
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
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">
                {isUBLTemplateSelected ? 'Category (Risk Category)' : 'Category'}
              </label>
              <select
                value={formData.risk_category}
                onChange={(e) => handleCategoryChange(e.target.value as RiskCategory)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              >
                {categoryOptions.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">
                {isUBLTemplateSelected ? 'Sub-Category (Sub-Source / Activity)' : 'Sub-Category'}
              </label>
              {isUBLTemplateSelected ? (
                <>
                  <input
                    type="text"
                    list="ubl-sub-source-options"
                    value={formData.risk_sub_category}
                    onChange={(e) => setFormData({ ...formData, risk_sub_category: e.target.value.slice(0, 100) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="Enter sub-source / activity..."
                  />
                  <datalist id="ubl-sub-source-options">
                    {ublSubCategorySuggestions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </>
              ) : (
                <select
                  value={formData.risk_sub_category}
                  onChange={(e) => setFormData({ ...formData, risk_sub_category: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
                >
                  <option value="">Select sub-category...</option>
                  {subCategories.map((sub) => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as RiskStatus })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              >
                {RISK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Business Owner</label>
              <select
                value={formData.business_owner_id || ''}
                onChange={(e) => setFormData({ ...formData, business_owner_id: e.target.value ? Number(e.target.value) : undefined })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              >
                <option value="">Select owner...</option>
                {(users || []).map((user) => (
                  <option key={user.id} value={user.id}>{user.full_name || user.email}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Linked Assets (Optional)</label>
            <input
              type="text"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="Search assets by name..."
            />
            <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-slate-300 bg-white">
              {filteredAssets.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-600">No assets found</p>
              ) : (
                filteredAssets.map((asset) => {
                  const checked = selectedAssetIds.includes(asset.id);
                  return (
                    <label
                      key={asset.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm text-slate-900 last:border-b-0 hover:bg-slate-100"
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

          <div>
            <label className="block text-sm text-slate-600 mb-2">Affected Departments</label>
            <div className="flex flex-wrap gap-2">
              {DEPARTMENTS.map((dept) => (
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Inherent Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_likelihood}
                onChange={(e) => setFormData({ ...formData, inherent_likelihood: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Inherent Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_impact}
                onChange={(e) => setFormData({ ...formData, inherent_impact: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Residual Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_likelihood}
                onChange={(e) => setFormData({ ...formData, residual_likelihood: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Residual Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_impact}
                onChange={(e) => setFormData({ ...formData, residual_impact: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-slate-600">Treatment Plan</label>
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
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 transition-all duration-150 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              rows={formData.treatment_plan.length > 200 ? 8 : 2}
            />
          </div>

          </div>

          <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {risk ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

