/**
 * Canonical React Query keys for scorecard overview endpoints.
 * Main dashboard cards and module scorecard pages MUST share these keys so
 * they read the same API payload and stay in sync after weight tuning.
 */
export const SCORECARD_QUERY_KEYS = {
  governance: ['governance-documents-overview'] as const,
  compliance: ['compliance-sections-overview'] as const,
  assessments: ['assessments-board-overview'] as const,
  assets: ['inventory-overview'] as const,
  issues: ['issue-incident-sections-overview'] as const,
  assurance: ['assurance-sections-overview'] as const,
  erm: ['erm-sections-overview'] as const,
} as const;
