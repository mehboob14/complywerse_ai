'use client';

// The Add / Edit Risk form (a right-hand panel), moved out of the 3,400-line list page UNCHANGED in what it asks and sends: the register-template blocks (UBL, NCA, 1LINK), AI Assist,
// the tenant's custom fields, linked assets, and the scores a new risk starts with (inherent 3 x 3, residual 2 x 2: creation defaults are not this pass's to change). The register
// (RiskRegister.tsx) opens it for Add and Edit; the risk page opens the same panel for the full form. What was changed on the way: it no longer asks to be thrown away with an unsaved
// change silently, the two-column grid is one column on a phone, and the panel names its save error plainly.
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, assetsApi, ermApi, teamsApi, aiRecommendationsApi, governanceApi } from '@/lib/api';
import { ITAsset, Risk, RiskCategory, RiskStatus } from '@/types';
import {
  AlertTriangle, Loader2, Plus, X, Sparkles, ChevronDown, ChevronRight, ChevronUp, Check, Zap, Building2, TrendingUp, TrendingDown, Shield, ClipboardCheck,
} from 'lucide-react';
import AiRecommendationSaver from '@/components/ai/AiRecommendationSaver';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { SearchInput } from '@/components/ui/SearchInput';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import {
  CustomFieldsTab, CustomFieldsTabBar, builtinLabel, errorText, listOptions, showBuiltin, statusChoices, tabOf, useModuleSettings, valuesToSave, type CustomValues,
} from '@/components/settings/CustomFields';
import { PRIORITIES } from '@/components/settings/PrioritySla';
import OneLinkRegisterFields, { initOneLinkValue, deriveCore, type OneLinkValue } from '../_components/OneLinkRegisterFields';

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
  { value: 'strategic', label: 'Strategic', color: 'text-primary-700', bgColor: 'bg-primary-50' },
  { value: 'operational', label: 'Operational', color: 'text-primary-700', bgColor: 'bg-primary-50' },
  { value: 'financial', label: 'Financial', color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  { value: 'compliance', label: 'Compliance', color: 'text-amber-700', bgColor: 'bg-amber-50' },
  { value: 'technology', label: 'Technology', color: 'text-primary-700', bgColor: 'bg-primary-50' },
  { value: 'third_party', label: 'Third Party', color: 'text-orange-700', bgColor: 'bg-orange-50' },
  { value: 'project_change', label: 'Project/Change', color: 'text-slate-700', bgColor: 'bg-slate-100' },
  { value: 'internal', label: 'Internal', color: 'text-slate-700', bgColor: 'bg-slate-100' },
];

const UBL_RISK_CATEGORIES: { value: RiskCategory; label: string; color: string; bgColor: string }[] = [
  { value: 'isms', label: 'ISMS', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  { value: 'process', label: 'Process', color: 'text-primary-700', bgColor: 'bg-primary-100' },
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

const ONELINK_REGISTER_TYPE = '1LINK';

const REGISTER_TYPES = [
  { value: UBL_TEMPLATE_REGISTER_TYPE, label: 'Template' },
  { value: NCA_TEMPLATE_REGISTER_TYPE, label: 'NCA Template' },
  { value: ONELINK_REGISTER_TYPE, label: '1LINK' },
  { value: 'RCSA', label: 'RCSA' },
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

// Matches both the current '1LINK' label and the legacy '1LINK ERM RCSA' value
// still stored on older rows.
const isOneLinkRegisterTypeValue = (value: string | null | undefined) =>
  canonicalFilterValue(value).includes(canonicalFilterValue(ONELINK_REGISTER_TYPE));

// The per-client register templates keep their own entries until they are
// moved into each tenant's custom fields; the other register types are the
// tenant's own list (module settings → risks → register_type).
const isTemplateRegisterTypeValue = (value: string | null | undefined) =>
  isUBLRegisterTypeValue(value) || isNcaRegisterTypeValue(value) || isOneLinkRegisterTypeValue(value);

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
  { value: 'open', label: 'Open', color: 'text-rose-700', bgColor: 'bg-rose-50' },
  { value: 'in_treatment', label: 'In Treatment', color: 'text-amber-700', bgColor: 'bg-amber-50' },
  { value: 'mitigated', label: 'Mitigated', color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  { value: 'accepted', label: 'Accepted', color: 'text-primary-700', bgColor: 'bg-primary-50' },
  { value: 'closed', label: 'Closed', color: 'text-slate-700', bgColor: 'bg-slate-100' },
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
  return RISK_STATUSES.find(s => s.value === status) || {
    value: status, label: String(status || '').replace(/_/g, ' '), color: 'text-slate-700', bgColor: 'bg-slate-100',
  };
};

const getScoreColor = (score: number | undefined) => {
  if (!score) return { text: 'text-slate-600', bg: 'bg-slate-100' };
  if (score >= 20) return { text: 'text-rose-700', bg: 'bg-rose-50' };
  if (score >= 12) return { text: 'text-orange-700', bg: 'bg-orange-50' };
  if (score >= 6) return { text: 'text-amber-700', bg: 'bg-amber-50' };
  return { text: 'text-emerald-700', bg: 'bg-emerald-50' };
};

/** The priority a score falls in when none is set on the risk (the same bands as the dashboard). */
const priorityForScore = (score: number) =>
  (score >= 20 ? 'critical' : score >= 12 ? 'high' : score >= 6 ? 'medium' : score > 0 ? 'low' : '');

const getHeatmapCellColor = (likelihood: number, impact: number) => {
  const score = likelihood * impact;
  if (score >= 20) return 'bg-rose-500 hover:bg-rose-600';
  if (score >= 15) return 'bg-rose-400 hover:bg-rose-500';
  if (score >= 12) return 'bg-orange-400 hover:bg-orange-500';
  if (score >= 8) return 'bg-amber-400 hover:bg-amber-500';
  if (score >= 4) return 'bg-emerald-400 hover:bg-emerald-500';
  return 'bg-emerald-500 hover:bg-emerald-600';
};

// 1LINK ERM Framework uses a 3×3 grid banded Low (1–2), Medium (3–4), High (6–9).
const getOneLinkHeatmapCellColor = (likelihood: number, impact: number) => {
  const score = likelihood * impact;
  if (score >= 6) return 'bg-rose-500 hover:bg-rose-600';
  if (score >= 3) return 'bg-amber-400 hover:bg-amber-500';
  return 'bg-emerald-500 hover:bg-emerald-600';
};

/** Clamp a possibly 5-scale likelihood/impact onto the 1LINK 3-point scale. */
const clampTo3 = (n: number) => Math.min(3, Math.max(1, n));


interface User {
  id: number;
  email: string;
  full_name?: string;
}

export interface AISuggestion {
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

export interface RiskModalSubmitPayload {
  riskData: Partial<Risk>;
  linkedAssetIds?: number[];
  aiSuggestions?: AISuggestion | null;
}

export function RiskModal({
  isOpen = true,
  risk,
  onClose,
  onSubmit,
  isLoading,
  initialRegisterType = '',
  nextOneLinkSeq = 1,
}: {
  isOpen?: boolean;
  risk: Risk | null;
  onClose: () => void;
  onSubmit: (payload: RiskModalSubmitPayload) => Promise<void> | void;
  isLoading: boolean;
  /** Preselect the register type (e.g. from the list's active filter). */
  initialRegisterType?: string;
  /** Next sequence number for system-generated 1LINK S.No. / RISK ID. */
  nextOneLinkSeq?: number;
}) {
  const [formData, setFormData] = useState({
    title: risk?.title || '',
    description: risk?.description || '',
    register_type: risk?.register_type || initialRegisterType || '',
    risk_category: risk?.risk_category || 'operational' as RiskCategory,
    risk_sub_category: risk?.risk_sub_category || toInputString((risk?.ubl_fields as Record<string, unknown> | undefined)?.sub_source_activity || ''),
    owner_id: (risk as unknown as { owner_id?: number | null } | null)?.owner_id || undefined as number | undefined,
    business_owner_id: risk?.business_owner_id || undefined as number | undefined,
    affected_department_ids: risk?.affected_department_ids || [] as number[],
    // Owning team (admin/teams). Backend resolves this to a real
    // BusinessUnit row (auto-mirrored by name) and stores it on the
    // risk's business_unit_id column so existing joins keep working.
    team_id: ((risk as unknown as { team_id?: number; business_unit_id?: number } | null)?.team_id
      ?? (risk as unknown as { business_unit_id?: number } | null)?.business_unit_id
      ?? undefined) as number | undefined,
    status: risk?.status || 'open' as RiskStatus,
    priority: risk?.priority || '',   // empty = from the score
    inherent_likelihood: risk?.inherent_likelihood || 3,
    inherent_impact: risk?.inherent_impact || 3,
    residual_likelihood: risk?.residual_likelihood || 2,
    residual_impact: risk?.residual_impact || 2,
    treatment_plan: risk?.treatment_plan || '',
    root_cause: (risk as unknown as { root_cause?: string } | null)?.root_cause || '',
    consequences: (risk as unknown as { consequences?: string } | null)?.consequences || '',
    recommendations: (risk as unknown as { recommendations?: string } | null)?.recommendations || '',
  });
  const [tab, setTab] = useState<'details' | 'custom'>('details');
  const [customValues, setCustomValues] = useState<CustomValues>(() => risk?.custom_values || {});
  const [saveError, setSaveError] = useState<string | null>(null);
  const snapshotNow = () => JSON.stringify([formData, selectedAssetIds, customValues, ublFields, templateFields]);
  const [firstSnapshot, setFirstSnapshot] = useState<string | null>(null);
  const { data: fieldSettings } = useModuleSettings('risks');
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

  // 1LINK template fields (seeded from the risk's template_fields on edit).
  const [templateFields, setTemplateFields] = useState<OneLinkValue>(() =>
    initOneLinkValue(risk?.template_fields as Record<string, unknown> | undefined),
  );

  // Unsaved changes: the panel asks before Escape, the X or the scrim throw them away. The first snapshot is taken after the form has settled (a 1LINK register fills its own numbers).
  const snapshot = useRef(snapshotNow);
  snapshot.current = snapshotNow;
  useEffect(() => {
    const t = window.setTimeout(() => setFirstSnapshot(snapshot.current()), 0);
    return () => window.clearTimeout(t);
  }, []);
  const dirty = firstSnapshot !== null && snapshotNow() !== firstSnapshot;

  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion | null>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // Which AI sections the user has "saved to field" — the button flips to "Saved"
  // briefly, then that suggestion block auto-hides from the panel.
  const [savedSections, setSavedSections] = useState<Set<string>>(new Set());
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set());
  // AI Assist is one-shot per risk entry: once generated (or rehydrated), the
  // button stays disabled on this entry; other risks can still use Assist.
  const [aiAssistUsed, setAiAssistUsed] = useState(false);
  // Recommended Controls is collapsed by default (it otherwise consumes space).
  const [showControls, setShowControls] = useState(false);

  // Rehydrate a previously generated AI suggestion when the modal reopens for
  // an existing risk. Presence of a saved record also locks AI Assist (atomic).
  useEffect(() => {
    const rid = risk?.id;
    if (!rid) {
      setAiAssistUsed(false);
      return;
    }
    let cancelled = false;
    aiRecommendationsApi
      .list({ module: 'erm_risk_suggestion', recommendation_type: 'ai_suggestion', entity_type: 'risk', entity_id: String(rid) })
      .then((res) => {
        if (cancelled) return;
        const found = ((res.data as { items?: Array<{ output?: unknown }> })?.items || [])[0];
        if (found?.output) {
          // Normalize so a partial/older saved record never throws on render
          // (the panel maps over these arrays unconditionally).
          const o = found.output as Partial<AISuggestion>;
          setAiSuggestions({
            suggested_description: o.suggested_description || '',
            suggested_causes: o.suggested_causes || [],
            suggested_consequences: o.suggested_consequences || [],
            suggested_recommendations: o.suggested_recommendations || [],
            recommended_controls: o.recommended_controls || [],
            suggested_likelihood: o.suggested_likelihood || 0,
            suggested_impact: o.suggested_impact || 0,
            risk_treatment_options: o.risk_treatment_options || [],
          });
          setShowSuggestions(true);
          setSavedSections(new Set());
          setHiddenSections(new Set());
          setAiAssistUsed(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [risk?.id]);

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

  // Active departments (each as its picker record, admin/teams). These drive the "Assigned Team / Department"
  // picker — replacing the hardcoded list that the tenant couldn't edit.
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
  const isOneLinkSelected = isOneLinkRegisterTypeValue(formData.register_type);

  // 1LINK: S.No. / RISK ID are system-generated on create (RK-001, RK-002, …).
  useEffect(() => {
    if (!isOneLinkSelected || risk) return;
    setTemplateFields((prev) => {
      if (prev.risk_id && prev.serial_no) return prev;
      return {
        ...prev,
        serial_no: prev.serial_no || String(nextOneLinkSeq),
        risk_id: prev.risk_id || `RK-${String(nextOneLinkSeq).padStart(3, '0')}`,
      };
    });
  }, [isOneLinkSelected, risk, nextOneLinkSeq]);

  // Platform entities for the 1LINK linkage dropdowns (incidents, internal
  // controls, governance documents). Only fetched while the 1LINK template
  // is active in the form.
  const { data: oneLinkIncidents } = useQuery({
    queryKey: ['erm-incidents-for-onelink'],
    queryFn: async () => {
      try {
        const response = await ermApi.incidents.getAll();
        return response.data || [];
      } catch {
        return [];
      }
    },
    enabled: isOneLinkSelected,
    staleTime: 60 * 1000,
  });
  const { data: oneLinkControls } = useQuery({
    queryKey: ['erm-internal-controls-for-onelink'],
    queryFn: async () => {
      try {
        const response = await ermApi.internalControls.getAll();
        const data: any = response.data;
        return (Array.isArray(data) ? data : data?.items || []) as Array<{ id: number; control_id?: string; name?: string }>;
      } catch {
        return [];
      }
    },
    enabled: isOneLinkSelected,
    staleTime: 60 * 1000,
  });
  const { data: oneLinkDocuments } = useQuery({
    queryKey: ['governance-documents-for-onelink'],
    queryFn: async () => {
      try {
        const response = await governanceApi.getDocumentsBrief({ limit: 500 });   // titles: also for people without a governance right
        const data: any = response.data;
        return (Array.isArray(data) ? data : data?.items || []) as Array<{ id: number; title?: string }>;
      } catch {
        return [];
      }
    },
    enabled: isOneLinkSelected,
    staleTime: 60 * 1000,
  });

  const oneLinkLookups = useMemo(() => ({
    users: (users || []).map((u) => u.full_name || u.email).filter(Boolean),
    departments: ((teams || []) as Array<{ name?: string }>).map((t) => t.name || '').filter(Boolean),
    incidents: ((oneLinkIncidents || []) as Array<{ id: number; title?: string }>).map(
      (i) => `INC-${i.id}${i.title ? ` · ${i.title}` : ''}`,
    ),
    controls: (oneLinkControls || []).map(
      (c) => `${c.control_id || `IC-${c.id}`}${c.name ? ` · ${c.name}` : ''}`,
    ),
    documents: (oneLinkDocuments || []).map((d) => d.title || `Document #${d.id}`).filter(Boolean),
  }), [users, teams, oneLinkIncidents, oneLinkControls, oneLinkDocuments]);

  const categoryOptions: Array<{ value: string; label: string }> = isUBLTemplateSelected
    ? RISK_CATEGORIES.filter((category) => UBL_ONLY_RISK_CATEGORIES.includes(category.value))
    : listOptions(fieldSettings, 'category', formData.risk_category, STANDARD_RISK_CATEGORIES);
  const registerTypeItems = [
    ...REGISTER_TYPES.filter((t) => isTemplateRegisterTypeValue(t.value)),
    ...listOptions(fieldSettings, 'register_type',
      isTemplateRegisterTypeValue(formData.register_type) ? '' : formData.register_type,
      REGISTER_TYPES.filter((t) => !isTemplateRegisterTypeValue(t.value))),
  ].map((t) => ({ value: t.value, label: t.label }));
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

  const subsFor = (category: string) => {
    const opt = fieldSettings?.lists?.category?.options?.find((o) => o.value === category);
    if (opt?.children?.length) return opt.children;
    return SUB_CATEGORIES_BY_CATEGORY[category as RiskCategory] || [];
  };
  const subCategories = subsFor(formData.risk_category);

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
      : (subsFor(nextCategory).includes(formData.risk_sub_category) ? formData.risk_sub_category : '');
    setFormData({
      ...formData,
      register_type: newRegisterType,
      risk_category: nextCategory,
      risk_sub_category: nextSubCategory,
    });
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
    if (aiAssistUsed) return;
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
      const data = response.data as AISuggestion;
      setAiSuggestions(data);
      setShowSuggestions(true);
      setSavedSections(new Set());
      setHiddenSections(new Set());
      setAiAssistUsed(true);
      // Persist so reopen + other sessions treat this entry as already assisted.
      if (risk?.id) {
        aiRecommendationsApi
          .save({
            module: 'erm_risk_suggestion',
            recommendation_type: 'ai_suggestion',
            entity_type: 'risk',
            entity_id: String(risk.id),
            title: `AI suggestion · ${formData.title || 'risk'}`,
            output: data as unknown as Record<string, unknown>,
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error('AI suggestion error:', err);
      setAiError('Failed to get AI suggestions. Please try again.');
    } finally {
      setIsLoadingAI(false);
    }
  };

  // Save an AI section into its OWN field as a NUMBERED list (1. 2. 3.),
  // flip the button to "Saved", then auto-hide that suggestion block shortly after.
  const markSaved = (key: string) => {
    setSavedSections((prev) => new Set(prev).add(key));
    window.setTimeout(() => {
      setHiddenSections((prev) => new Set(prev).add(key));
    }, 900);
  };
  const isSectionVisible = (key: string) => !hiddenSections.has(key);
  const numbered = (items: string[]) => items.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const applyDescription = () => {
    if (!aiSuggestions?.suggested_description || savedSections.has('description')) return;
    setFormData((prev) => ({ ...prev, description: aiSuggestions.suggested_description }));
    markSaved('description');
  };
  const applyRootCauses = () => {
    if (savedSections.has('rootCauses')) return;
    const causes = aiSuggestions?.suggested_causes || [];
    if (causes.length) { setFormData((prev) => ({ ...prev, root_cause: numbered(causes) })); markSaved('rootCauses'); }
  };
  const applyRecommendations = () => {
    if (savedSections.has('recommendations')) return;
    const recs = aiSuggestions?.suggested_recommendations || [];
    if (recs.length) { setFormData((prev) => ({ ...prev, recommendations: numbered(recs) })); markSaved('recommendations'); }
  };
  const applyConsequences = () => {
    if (savedSections.has('consequences')) return;
    const cons = aiSuggestions?.suggested_consequences || [];
    if (cons.length) { setFormData((prev) => ({ ...prev, consequences: numbered(cons) })); markSaved('consequences'); }
  };
  const applyTreatmentOptions = () => {
    if (savedSections.has('treatment')) return;
    const opts = aiSuggestions?.risk_treatment_options || [];
    if (opts.length) { setFormData((prev) => ({ ...prev, treatment_plan: numbered(opts) })); markSaved('treatment'); }
  };
  // Per-section "Save to field" button styling + label (flips to "Saved").
  const savedBtnClass = (k: string) =>
    `flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
      savedSections.has(k) ? 'text-emerald-700 bg-emerald-50 cursor-default' : 'text-primary-600 hover:bg-primary-50'
    }`;
  const savedBtnLabel = (k: string) => (savedSections.has(k) ? 'Saved' : 'Save to field');

  const applyLikelihoodImpact = () => {
    if (!aiSuggestions || savedSections.has('rating')) return;
    setFormData((prev) => ({
      ...prev,
      inherent_likelihood: aiSuggestions.suggested_likelihood,
      inherent_impact: aiSuggestions.suggested_impact,
    }));
    markSaved('rating');
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

    setSaveError(null);
    try {
      await onSubmit({
        riskData: {
          ...formData,
          risk_sub_category: derivedSubCategory,
          inherent_score: formData.inherent_likelihood * formData.inherent_impact,
          residual_score: formData.residual_likelihood * formData.residual_impact,
          ubl_fields: isUBLTemplateSelected ? cleanedUblFields : undefined,
          ...(isOneLinkSelected ? deriveCore(templateFields) : {}),
          template_fields: isOneLinkSelected ? templateFields : undefined,
          custom_values: valuesToSave(fieldSettings, customValues, risk ? (risk.custom_values || {}) : null),
        },
        linkedAssetIds: selectedAssetIds,
        aiSuggestions: aiAssistUsed ? aiSuggestions : null,
      });
    } catch (err) {
      setSaveError(errorText(err, 'Could not save the risk.'));
    }
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
      dirty={dirty}
      width="w-full max-w-[780px]"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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
      {/* A required field left empty on the other tab: go to it. */}
      <form id="risk-modal-form" onSubmit={handleSubmit} onInvalidCapture={(e) => setTab(tabOf(e.target))} className="space-y-3">
        {saveError && (
          <p className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {saveError}
          </p>
        )}
        <CustomFieldsTabBar tab={tab} onTab={setTab} settings={fieldSettings} />
        <div data-tab="details" className={tab === 'details' ? 'space-y-3' : 'hidden'}>
          <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'title', 'Title')} *</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
                maxLength={255}
                placeholder="Enter risk title..."
              />
              <button
                type="button"
                onClick={handleGetAISuggestions}
                disabled={aiAssistUsed || isLoadingAI || formData.title.trim().length < 3}
                title={aiAssistUsed ? 'AI Assist already used for this risk' : 'Generate AI suggestions once for this risk'}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLoadingAI ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {aiAssistUsed ? 'AI Used' : 'AI Assist'}
              </button>
            </div>
            {aiError && (
              <p className="mt-1 text-xs text-rose-600">{aiError}</p>
            )}
          </div>

          {aiSuggestions && (
            <div className="rounded-xl border border-slate-200 bg-primary-50 p-[2px]">
              <div className="rounded-[10px] bg-white p-4">
                <button
                  type="button"
                  onClick={() => setShowSuggestions(!showSuggestions)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary-600" />
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
                    {isSectionVisible('description') && aiSuggestions.suggested_description && (
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Suggested Description</h4>
                        <button
                          type="button"
                          onClick={applyDescription}
                          className={savedBtnClass('description')}
                        >
                          <Check className="h-3 w-3" />
                          {savedBtnLabel('description')}
                        </button>
                      </div>
                      <p className="mt-1 text-sm text-slate-700 bg-slate-100/50 rounded-lg p-3">
                        {aiSuggestions.suggested_description}
                      </p>
                    </div>
                    )}

                    {(
                      (isSectionVisible('rootCauses') && (aiSuggestions.suggested_causes?.length || 0) > 0) ||
                      (isSectionVisible('consequences') && (aiSuggestions.suggested_consequences?.length || 0) > 0)
                    ) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {isSectionVisible('rootCauses') && (aiSuggestions.suggested_causes?.length || 0) > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Root Causes</h4>
                          <button type="button" onClick={applyRootCauses} className={savedBtnClass('rootCauses')}>
                            <Check className="h-3 w-3" /> {savedBtnLabel('rootCauses')}
                          </button>
                        </div>
                        <ol className="space-y-1.5">
                          {aiSuggestions.suggested_causes.map((cause, idx) => (
                            <li
                              key={idx}
                              className="flex gap-2 rounded-md border border-slate-200 border-l-4 border-l-rose-500 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                            >
                              <span className="font-semibold text-rose-600 tabular-nums">{idx + 1}.</span>
                              <span className="leading-snug">{cause}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      )}
                      {isSectionVisible('consequences') && (aiSuggestions.suggested_consequences?.length || 0) > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Consequences</h4>
                          <button type="button" onClick={applyConsequences} className={savedBtnClass('consequences')}>
                            <Check className="h-3 w-3" /> {savedBtnLabel('consequences')}
                          </button>
                        </div>
                        <ol className="space-y-1.5">
                          {aiSuggestions.suggested_consequences.map((consequence, idx) => (
                            <li
                              key={idx}
                              className="flex gap-2 rounded-md border border-slate-200 border-l-4 border-l-amber-500 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                            >
                              <span className="font-semibold text-amber-600 tabular-nums">{idx + 1}.</span>
                              <span className="leading-snug">{consequence}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      )}
                    </div>
                    )}

                    {isSectionVisible('recommendations') && Array.isArray(aiSuggestions.suggested_recommendations) && aiSuggestions.suggested_recommendations.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Recommendations</h4>
                          <button type="button" onClick={applyRecommendations} className={savedBtnClass('recommendations')}>
                            <Check className="h-3 w-3" /> {savedBtnLabel('recommendations')}
                          </button>
                        </div>
                        <ol className="space-y-1.5">
                          {aiSuggestions.suggested_recommendations.map((rec, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 rounded-md border border-slate-200 border-l-4 border-l-emerald-500 bg-white px-2.5 py-1.5 text-sm text-slate-800"
                            >
                              <span className="font-semibold text-emerald-600 tabular-nums">{idx + 1}.</span>
                              <span className="leading-snug text-xs">{rec}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {isSectionVisible('rating') && (
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Suggested Risk Rating</h4>
                        <button
                          type="button"
                          onClick={applyLikelihoodImpact}
                          className={savedBtnClass('rating')}
                        >
                          <Check className="h-3 w-3" />
                          {savedBtnLabel('rating') === 'Saved' ? 'Saved' : 'Apply'}
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">Likelihood:</span>
                          <span className="rounded bg-primary-100 px-2 py-0.5 text-sm font-medium text-primary-700">
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
                    )}

                    {aiSuggestions.recommended_controls.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowControls((s) => !s)}
                          className="mb-2 flex w-full items-center justify-between text-left"
                        >
                          <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Recommended Controls ({aiSuggestions.recommended_controls.length})</h4>
                          {showControls ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                        </button>
                        {showControls && (
                        <div className="space-y-2">
                          {aiSuggestions.recommended_controls.map((control) => (
                            <div
                              key={control.control_id}
                              className="flex items-start gap-3 rounded-lg bg-slate-100/50 p-3"
                            >
                              <Shield className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
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
                                    <span className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${
                                      control.control_source === 'internal'
                                        ? 'bg-primary-100 text-primary-700'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}>
                                      {control.control_source === 'internal' ? 'Internal' : 'Framework'}
                                    </span>
                                  )}
                                  <span className={`rounded px-1.5 py-0.5 text-xs ${
                                    control.relevance === 'high'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : control.relevance === 'medium'
                                      ? 'bg-amber-100 text-amber-700'
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
                        )}
                      </div>
                    )}

                    {isSectionVisible('treatment') && (aiSuggestions.risk_treatment_options?.length || 0) > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Treatment Options</h4>
                        <button type="button" onClick={applyTreatmentOptions} className={savedBtnClass('treatment')}>
                          <Check className="h-3 w-3" /> {savedBtnLabel('treatment')}
                        </button>
                      </div>
                      <ol className="space-y-1.5">
                        {aiSuggestions.risk_treatment_options.map((option, idx) => (
                          <li
                            key={idx}
                            className="flex gap-2 rounded-md border border-slate-200 border-l-4 border-l-primary-500 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                          >
                            <span className="font-semibold text-primary-600 tabular-nums">{idx + 1}.</span>
                            <span className="leading-snug">{option}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {showBuiltin(fieldSettings, 'description') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'description', 'Description')}</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={3}
              placeholder="Describe the risk..."
            />
          </div>}

          {showBuiltin(fieldSettings, 'register_type') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'register_type', 'Register Type')}</label>
            <MultiSelectDropdown
              title="Register Type"
              items={registerTypeItems}
              selectedValues={formData.register_type ? [formData.register_type] : []}
              onApply={(vals) => handleRegisterTypeChange(vals[0] || '')}
              multiSelect={false}
              triggerVariant="input"
              placeholder="Select Register Type"
              size="md"
            />
          </div>}

          {isUBLTemplateSelected && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-800">Register Fields</h3>
              <p className="mt-1 text-xs text-slate-500">
                Fill relevant columns from the selected register type. Risk ID is system generated.
              </p>
              {systemUblRiskId && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[12px] font-medium text-slate-500">System Risk ID</p>
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
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isOneLinkSelected && (
            <OneLinkRegisterFields value={templateFields} onChange={setTemplateFields} lookups={oneLinkLookups} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {showBuiltin(fieldSettings, 'category') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">
                {isUBLTemplateSelected ? 'Category (Risk Category)' : builtinLabel(fieldSettings, 'category', 'Category')}
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
            </div>}
            {showBuiltin(fieldSettings, 'sub_category') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">
                {isUBLTemplateSelected ? 'Sub-Category (Sub-Source / Activity)' : builtinLabel(fieldSettings, 'sub_category', 'Sub-Category')}
              </label>
              {isUBLTemplateSelected ? (
                <>
                  <input
                    type="text"
                    list="ubl-sub-source-options"
                    value={formData.risk_sub_category}
                    onChange={(e) => setFormData({ ...formData, risk_sub_category: e.target.value.slice(0, 100) })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
            </div>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">Priority</label>
              <MultiSelectDropdown
                title="Priority"
                items={[
                  {
                    value: 'auto',
                    label: `Auto${priorityForScore(formData.residual_likelihood * formData.residual_impact || formData.inherent_likelihood * formData.inherent_impact) ? ` (${priorityForScore(formData.residual_likelihood * formData.residual_impact || formData.inherent_likelihood * formData.inherent_impact)})` : ''}`,
                    subLabel: 'From the risk score',
                  },
                  ...PRIORITIES,
                ]}
                selectedValues={[formData.priority || 'auto']}
                onApply={(vals) => setFormData({ ...formData, priority: vals[0] && vals[0] !== 'auto' ? vals[0] : '' })}
                multiSelect={false}
                triggerVariant="input"
                size="md"
              />
            </div>
            <p className="self-end pb-2 text-xs text-slate-500">The SLA for this risk follows its priority (Risk register → Settings).</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {showBuiltin(fieldSettings, 'status') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'status', 'Status')}</label>
              <MultiSelectDropdown
                title="Status"
                items={statusChoices(fieldSettings, RISK_STATUSES)}
                selectedValues={formData.status ? [formData.status] : []}
                onApply={(vals) => setFormData({ ...formData, status: (vals[0] || 'open') as RiskStatus })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select Status"
                size="md"
              />
            </div>}
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">Risk Owner
                <span className="ml-1 text-xs font-normal text-slate-500">(counts toward the Ownership score)</span>
              </label>
              <MultiSelectDropdown
                title="Risk Owner"
                items={(users || []).map((user) => ({
                  value: String(user.id),
                  label: user.full_name || user.email,
                  subLabel: user.full_name ? user.email : undefined,
                }))}
                selectedValues={formData.owner_id ? [String(formData.owner_id)] : []}
                onApply={(vals) => setFormData({ ...formData, owner_id: vals[0] ? Number(vals[0]) : undefined })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select Owner"
                size="md"
                forceSearch
              />
            </div>
            {showBuiltin(fieldSettings, 'owner') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'owner', 'Business Owner')}</label>
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
            </div>}
          </div>

          {/* Assigned team / department picker — backed by admin/teams.
              When the risk is saved the backend resolves this team_id to
              a BusinessUnit row (creating one named after the team if
              none exists) and stores it on the risk's business_unit_id.
              That same business_unit_id is what RCSA assessments and the
              dashboard's BU-progress panel are keyed on, so a risk
              assigned here lands in the right team's scope automatically. */}
          {showBuiltin(fieldSettings, 'team') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">
              {builtinLabel(fieldSettings, 'team', 'Assigned Team / Department')}
              <span className="ml-1 text-xs font-normal text-slate-500">(defines who owns and reviews this risk)</span>
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
              placeholder={(teams || []).length === 0 ? 'No departments configured yet' : 'Select a team / department'}
              size="md"
              forceSearch
            />
          </div>}

          {showBuiltin(fieldSettings, 'linked_assets') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'linked_assets', 'Linked Assets (Optional)')}</label>
            <div className="rounded-lg border border-slate-300 bg-white p-2">
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
          </div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {showBuiltin(fieldSettings, 'inherent_likelihood') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'inherent_likelihood', 'Inherent Likelihood (1-5)')}</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_likelihood}
                onChange={(e) => setFormData({ ...formData, inherent_likelihood: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>}
            {showBuiltin(fieldSettings, 'inherent_impact') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'inherent_impact', 'Inherent Impact (1-5)')}</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_impact}
                onChange={(e) => setFormData({ ...formData, inherent_impact: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {showBuiltin(fieldSettings, 'residual_likelihood') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'residual_likelihood', 'Residual Likelihood (1-5)')}</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_likelihood}
                onChange={(e) => setFormData({ ...formData, residual_likelihood: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>}
            {showBuiltin(fieldSettings, 'residual_impact') && <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'residual_impact', 'Residual Impact (1-5)')}</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_impact}
                onChange={(e) => setFormData({ ...formData, residual_impact: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>}
          </div>

          {/* Field sequence: Root Cause → Consequences → Recommendations → Treatment Plan */}
          {showBuiltin(fieldSettings, 'root_cause') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'root_cause', 'Root Cause')}</label>
            <textarea
              value={formData.root_cause}
              onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={formData.root_cause.length > 200 ? 6 : 2}
              placeholder="Why this risk exists (use AI Assist → Root Causes → Save to field, or write your own)…"
            />
          </div>}
          {showBuiltin(fieldSettings, 'consequences') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'consequences', 'Consequences')}</label>
            <textarea
              value={formData.consequences}
              onChange={(e) => setFormData({ ...formData, consequences: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={formData.consequences.length > 200 ? 6 : 2}
              placeholder="Potential impact/consequences if this risk materializes (AI Assist → Consequences → Save to field, or write your own)…"
            />
          </div>}
          {showBuiltin(fieldSettings, 'recommendations') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'recommendations', 'Recommendations')}</label>
            <textarea
              value={formData.recommendations}
              onChange={(e) => setFormData({ ...formData, recommendations: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={formData.recommendations.length > 200 ? 6 : 2}
              placeholder="Recommended actions to reduce this risk (AI Assist → Recommendations → Save to field, or write your own)…"
            />
          </div>}
          {showBuiltin(fieldSettings, 'treatment_plan') && <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">{builtinLabel(fieldSettings, 'treatment_plan', 'Treatment Plan')}</label>
            <textarea
              value={formData.treatment_plan}
              onChange={(e) => setFormData({ ...formData, treatment_plan: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={formData.treatment_plan.length > 200 ? 8 : 2}
              placeholder="Treatment approach (use AI Assist → Treatment Options → Save to field, or write your own)…"
            />
          </div>}
        </div>
        <div data-tab="custom" className={tab === 'custom' ? '' : 'hidden'}>
          <CustomFieldsTab moduleKey="risks" values={customValues} onChange={setCustomValues} />
        </div>
      </form>
    </RightSlidePanel>
  );
}

