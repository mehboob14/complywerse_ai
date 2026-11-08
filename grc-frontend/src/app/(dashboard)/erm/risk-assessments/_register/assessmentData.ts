'use client';

// The requests the Risk Assessments pages share, each under ONE query key, and the one place that says who may write.
//
// Rights: the server asks `erm:risks:view` of every /erm route and nothing more of an assessment (no write key), so the pages show a write control to anyone who can read the data. The old pages asked
// `erm:risk_assessments:*` (not in the catalogue: only administrators ever saw Edit, Start, Create, Delete) and the menu `risks:risk_assessment:*` (a key that cannot load any data). Which key the
// user wants is a decision for later; it is this one line.
import { useQuery } from '@tanstack/react-query';
import { assetsApi, ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { AssessmentRegister } from './assessmentModel';

export const REGISTER_KEY = ['erm-assessment-register'] as const;
/** Keys a change to an assessment refreshes: the home, the Overview's section figures and the old dashboard's key. */
export const ASSESSMENT_REFRESH: ReadonlyArray<readonly unknown[]> = [REGISTER_KEY, ['erm-sections-overview'], ['erm-risk-assessments-dashboard'], ['framework-risk-assessments'], ['framework-risk-assessment-assigned-questions']];

const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

export function useAssessmentRegister() {
  return useQuery({ queryKey: [...REGISTER_KEY], queryFn: async () => (await ermApi.riskAssessments.getRegister()).data as unknown as AssessmentRegister, retry });
}

export function useAssessmentRights(): { canWrite: boolean; ready: boolean } {
  const { hasPermission, isLoading } = usePermissions();
  return { canWrite: hasPermission('erm:risks:view'), ready: !isLoading };
}

export interface PersonOption { id: number; display_name: string; email?: string | null }
export function useAssessmentPeople() {
  return useQuery({
    queryKey: ['tenant-users-erm'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data as unknown as PersonOption[],
    staleTime: 5 * 60 * 1000,
  });
}
