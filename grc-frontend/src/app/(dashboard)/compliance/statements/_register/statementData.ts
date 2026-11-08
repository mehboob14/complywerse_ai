'use client';

// The requests the Statements register shares, each under ONE query key. The list is loaded whole, in pages of 1,000 (the server's own limit), so the search, the rail's counts and
// "Assigned to me" are over every statement, and the number above the list is the server's `total`, not the length of a page. A failed request is an error the page says, with
// Retry, never an empty list.
import { useQuery } from '@tanstack/react-query';
import { complianceApi, evidenceApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import type { StatementRow } from './statementModel';

export const STATEMENTS_KEY = ['compliance-statements-all'] as const;
/** the keys a change to a statement refreshes: this list, the old list's key (the Governance widgets and the dashboard read it), the one statement, the compliance score that counts statements */
export const STATEMENT_REFRESH: ReadonlyArray<readonly unknown[]> = [STATEMENTS_KEY, ['compliance-statements'], ['compliance-statement'], ['compliance-dashboard-summary'], [...SCORECARD_QUERY_KEYS.compliance]];

/** The most a request returns (statements.py: `le=1000`). */
export const PAGE = 1000;
/** A tenant with more than this is told it is looking at the newest part (5,000 statements is several hundred policy documents). */
export const MAX_PAGES = 5;

export interface StatementList { items: StatementRow[]; total: number; truncated: boolean }

/** A refusal is final; anything else is tried once more after a short wait. */
export const retryRead = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;

export async function fetchAllStatements(): Promise<StatementList> {
  const items: StatementRow[] = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = (await complianceApi.statements.getAll({ skip: page * PAGE, limit: PAGE })).data as { statements?: StatementRow[]; total?: number };
    const got = data.statements ?? [];
    items.push(...got);
    total = typeof data.total === 'number' ? data.total : items.length;
    if (got.length === 0 || items.length >= total) break;
  }
  return { items, total, truncated: items.length < total };
}

export function useStatements() {
  return useQuery({ queryKey: [...STATEMENTS_KEY], queryFn: fetchAllStatements, retry: retryRead, retryDelay: 800 });
}

export interface StatementDetail {
  id: number;
  statement_code: string | null;
  statement_text: string | null;
  statement_summary: string | null;
  document_id: number;
  document_title: string | null;
  document_code: string | null;
  category: string | null;
  priority: string | null;
  is_mandatory: boolean;
  source_section: string | null;
  assigned_to_user_id: number | null;
  assignee_name: string | null;
  assignee_email?: string | null;
  compliance: {
    compliance_status: string;
    owner_name: string | null;
    assessment_date: string | null;
    assessor_name?: string | null;
    findings: string | null;
    remediation_notes: string | null;
    next_assessment_date: string | null;
    evidence_ids: number[];
  } | null;
  evidence: Array<{ id: number; name: string; file_name: string | null; status: string | null }>;
}

export function useStatementDetail(id: number | null) {
  return useQuery({
    queryKey: ['compliance-statement', id],
    queryFn: async () => (await complianceApi.statements.getById(id as number)).data as StatementDetail,
    enabled: id != null,
    retry: retryRead,
    retryDelay: 800,
  });
}

export interface TenantUser { id: number; username?: string; display_name?: string; email?: string }

export function useTenantUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['compliance-statements-tenant-users'],
    queryFn: async () => (await complianceApi.statements.getTenantUsers()).data as TenantUser[],
    enabled,
    staleTime: 5 * 60_000,
    retry: retryRead,
    retryDelay: 800,
  });
}

export interface EvidenceBrief { id: number; name?: string | null; evidence_type?: string | null }

export function useEvidenceBriefs(enabled: boolean) {
  return useQuery({
    queryKey: ['compliance-statements-evidence'],
    queryFn: async () => (await evidenceApi.getAll()).data as unknown as EvidenceBrief[],
    enabled,
    staleTime: 60_000,
    retry: retryRead,
    retryDelay: 800,
  });
}
