import React, { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/ToastProvider";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import GovernanceLayout from "@/app/(dashboard)/governance/layout";
import ComplianceLayout from "@/app/(dashboard)/compliance/layout";
import ErmLayout from "@/app/(dashboard)/erm/layout";
import FrameworkUploadLayout from "@/app/(dashboard)/framework-upload/layout";
import RisksLayout from "@/app/(dashboard)/risks/layout";
import VendorRiskLayout from "@/app/(dashboard)/vendor-risk/layout";
import { apiClient } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-base)] mx-auto mb-4"></div>
        <p className="text-slate-400">Loading...</p>
      </div>
    </div>
  );
}

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-base)]"></div>
    </div>
  );
}

function withGovernanceLayout(PageComponent: React.ComponentType) {
  return function WrappedPage() {
    return <GovernanceLayout><PageComponent /></GovernanceLayout>;
  };
}

function withComplianceLayout(PageComponent: React.ComponentType) {
  return function WrappedPage() {
    return <ComplianceLayout><PageComponent /></ComplianceLayout>;
  };
}

function withErmLayout(PageComponent: React.ComponentType) {
  return function WrappedPage() {
    return <ErmLayout><PageComponent /></ErmLayout>;
  };
}

function withFrameworkUploadLayout(PageComponent: React.ComponentType) {
  return function WrappedPage() {
    return <FrameworkUploadLayout><PageComponent /></FrameworkUploadLayout>;
  };
}

function withRisksLayout(PageComponent: React.ComponentType) {
  return function WrappedPage() {
    return <RisksLayout><PageComponent /></RisksLayout>;
  };
}

function withVendorRiskLayout(PageComponent: React.ComponentType) {
  return function WrappedPage() {
    return <VendorRiskLayout><PageComponent /></VendorRiskLayout>;
  };
}

const LoginPage = lazy(() => import("@/app/login/page"));
const RegisterPage = lazy(() => import("@/app/register/page"));
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const WelcomePage = lazy(() => import("@/pages/WelcomePage"));
const ConnectWizard = lazy(() => import("@/pages/ConnectWizard"));
const AppLandingPage = lazy(() => import("@/pages/AppLandingPage"));

const DashboardPage = lazy(() => import("@/app/(dashboard)/dashboard/page"));

const RisksPage = lazy(() => import("@/app/(dashboard)/risks/page"));
const RiskDetailPage = lazy(() => import("@/app/(dashboard)/risks/[id]/page"));
const RisksAdvancedPage = lazy(() => import("@/app/(dashboard)/risks/advanced/page"));
const RisksRcsaPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/page"));
const RisksRcsaTemplatesPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/templates/page"));
const RisksRcsaTemplateDetailPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/templates/[id]/page"));
const RisksRcsaCampaignsPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/campaigns/page"));
const RisksRcsaCampaignDetailPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/campaigns/[id]/page"));
const RisksRcsaAssessmentsPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/assessments/page"));
const RisksRcsaAssessmentDetailPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/assessments/[id]/page"));
const RisksRcsaFindingsPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/findings/page"));
const RisksRcsaFindingDetailPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/findings/[id]/page"));
const RisksRcsaApprovalsPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/approvals/page"));
const RisksRcsaApprovalDetailPage = lazy(() => import("@/app/(dashboard)/risks/rcsa/approvals/[id]/page"));

const CompliancePage = lazy(() => import("@/app/(dashboard)/compliance/page"));
const ComplianceStatementsPage = lazy(() => import("@/app/(dashboard)/compliance/statements/page"));
const ComplianceAssessmentsPage = lazy(() => import("@/app/(dashboard)/compliance/assessments/page"));
const ComplianceAssessmentDetailPage = lazy(() => import("@/app/(dashboard)/compliance/assessments/[id]/page"));
const ComplianceAssessmentsApprovalsPage = lazy(() => import("@/app/(dashboard)/compliance/assessments/approvals/page"));

const ControlsPage = lazy(() => import("@/app/(dashboard)/controls/page"));

const ControlLibraryPage = lazy(() => import("@/app/(dashboard)/control-library/page"));
const ControlLibraryDetailPage = lazy(() => import("@/app/(dashboard)/control-library/[id]/page"));
const ControlLibraryEvidencePage = lazy(() => import("@/app/(dashboard)/control-library/evidence/page"));
const ControlLibraryGapsPage = lazy(() => import("@/app/(dashboard)/control-library/gaps/page"));
const ControlLibraryComparePage = lazy(() => import("@/app/(dashboard)/control-library/compare/page"));

const FrameworksPage = lazy(() => import("@/app/(dashboard)/frameworks/page"));
const FrameworkDetailPage = lazy(() => import("@/app/(dashboard)/frameworks/[id]/page"));
const FrameworksOverviewDetailPage = lazy(() => import("@/app/(dashboard)/frameworks/overview/[id]/page"));

const FrameworkUploadPage = lazy(() => import("@/app/(dashboard)/framework-upload/page"));
const FrameworkUploadAlignmentPage = lazy(() => import("@/app/(dashboard)/framework-upload/alignment/page"));
const FrameworkUploadAssessmentPage = lazy(() => import("@/app/(dashboard)/framework-upload/assessment/page"));
const FrameworkUploadControlsPage = lazy(() => import("@/app/(dashboard)/framework-upload/controls/page"));

const GovernancePage = lazy(() => import("@/app/(dashboard)/governance/page"));
const GovernanceApprovalsPage = lazy(() => import("@/app/(dashboard)/governance/approvals/page"));
const GovernancePolicyAIPage = lazy(() => import("@/app/(dashboard)/governance/policy-ai/page"));
const GovernanceDocumentsPage = lazy(() => import("@/app/(dashboard)/governance/documents/page"));
const GovernanceDocumentDetailPage = lazy(() => import("@/app/(dashboard)/governance/documents/[id]/page"));
const GovernanceAttestationsPage = lazy(() => import("@/app/(dashboard)/governance/attestations/page"));
const GovernanceAttestationsCampaignsPage = lazy(() => import("@/app/(dashboard)/governance/attestations/campaigns/page"));
const GovernanceAttestationsCampaignDetailPage = lazy(() => import("@/app/(dashboard)/governance/attestations/campaigns/[id]/page"));
const GovernanceAttestationsCompleteDetailPage = lazy(() => import("@/app/(dashboard)/governance/attestations/complete/[id]/page"));
const GovernanceCommitteesPage = lazy(() => import("@/app/(dashboard)/governance/committees/page"));
const GovernanceCommitteeDetailPage = lazy(() => import("@/app/(dashboard)/governance/committees/[id]/page"));
const GovernanceCommitteeMeetingDetailPage = lazy(() => import("@/app/(dashboard)/governance/committees/meetings/[id]/page"));
const GovernanceCommitteeActionsPage = lazy(() => import("@/app/(dashboard)/governance/committees/actions/page"));
const GovernanceExceptionsPage = lazy(() => import("@/app/(dashboard)/governance/exceptions/page"));
const GovernanceMappingsPage = lazy(() => import("@/app/(dashboard)/governance/mappings/page"));
const GovernanceRegulatoryChangesPage = lazy(() => import("@/app/(dashboard)/governance/regulatory-changes/page"));
const GovernanceRegulatoryChangeDetailPage = lazy(() => import("@/app/(dashboard)/governance/regulatory-changes/[id]/page"));
const GovernanceRegulatoryFeedsPage = lazy(() => import("@/app/(dashboard)/governance/regulatory-feeds/page"));
const GovernanceReviewsPage = lazy(() => import("@/app/(dashboard)/governance/reviews/page"));
const GovernanceReviewsCalendarPage = lazy(() => import("@/app/(dashboard)/governance/reviews/calendar/page"));
const GovernanceWorkflowsPage = lazy(() => import("@/app/(dashboard)/governance/workflows/page"));

const EvidencePage = lazy(() => import("@/app/(dashboard)/evidence/page"));
const EvidenceDetailPage = lazy(() => import("@/app/(dashboard)/evidence/[id]/page"));
const EvidenceAuditPackagesPage = lazy(() => import("@/app/(dashboard)/evidence/audit-packages/page"));
const EvidenceRequirementsPage = lazy(() => import("@/app/(dashboard)/evidence-requirements/page"));

const AuditPage = lazy(() => import("@/app/(dashboard)/audit/page"));
const AuditEngagementsPage = lazy(() => import("@/app/(dashboard)/audit/engagements/page"));
const AuditEngagementDetailPage = lazy(() => import("@/app/(dashboard)/audit/engagements/[id]/page"));
const AuditFindingsPage = lazy(() => import("@/app/(dashboard)/audit/findings/page"));
const AuditFindingDetailPage = lazy(() => import("@/app/(dashboard)/audit/findings/[id]/page"));
const AuditPlansPage = lazy(() => import("@/app/(dashboard)/audit/plans/page"));
const AuditPlanDetailPage = lazy(() => import("@/app/(dashboard)/audit/plans/[id]/page"));
const AuditUniversePage = lazy(() => import("@/app/(dashboard)/audit/universe/page"));
const AuditUniverseDetailPage = lazy(() => import("@/app/(dashboard)/audit/universe/[id]/page"));
const AuditCapacityPage = lazy(() => import("@/app/(dashboard)/audit/capacity/page"));
const AuditCcmPage = lazy(() => import("@/app/(dashboard)/audit/ccm/page"));
const AuditQaipPage = lazy(() => import("@/app/(dashboard)/audit/qaip/page"));
const AuditReportingPage = lazy(() => import("@/app/(dashboard)/audit/reporting/page"));
const AuditSkillMatrixPage = lazy(() => import("@/app/(dashboard)/audit/skill-matrix/page"));
const AuditTestScriptsPage = lazy(() => import("@/app/(dashboard)/audit/test-scripts/page"));
const AuditNotificationsPage = lazy(() => import("@/app/(dashboard)/audit/notifications/page"));

const ErmPage = lazy(() => import("@/app/(dashboard)/erm/page"));
const ErmRisksPage = lazy(() => import("@/app/(dashboard)/erm/risks/page"));
const ErmKrisPage = lazy(() => import("@/app/(dashboard)/erm/kris/page"));
const ErmAppetitePage = lazy(() => import("@/app/(dashboard)/erm/appetite/page"));
const ErmDependenciesPage = lazy(() => import("@/app/(dashboard)/erm/dependencies/page"));
const ErmIncidentsPage = lazy(() => import("@/app/(dashboard)/erm/incidents/page"));
const ErmInternalControlsPage = lazy(() => import("@/app/(dashboard)/erm/internal-controls/page"));
const ErmInternalControlDetailPage = lazy(() => import("@/app/(dashboard)/erm/internal-controls/[id]/page"));
const ErmMitigationActionsPage = lazy(() => import("@/app/(dashboard)/erm/mitigation-actions/page"));
const ErmRcsaPage = lazy(() => import("@/app/(dashboard)/erm/rcsa/page"));
const ErmReportsPage = lazy(() => import("@/app/(dashboard)/erm/reports/page"));
const ErmReviewsPage = lazy(() => import("@/app/(dashboard)/erm/reviews/page"));
const ErmRiskAssessmentsPage = lazy(() => import("@/app/(dashboard)/erm/risk-assessments/page"));
const ErmRiskAssessmentDetailPage = lazy(() => import("@/app/(dashboard)/erm/risk-assessments/[id]/page"));
const ErmRiskAssessmentsFrameworkPage = lazy(() => import("@/app/(dashboard)/erm/risk-assessments/framework/page"));
const ErmRiskAssessmentsFrameworkDetailPage = lazy(() => import("@/app/(dashboard)/erm/risk-assessments/framework/[id]/page"));
const ErmAnalyticsPage = lazy(() => import("@/app/(dashboard)/erm/analytics/page"));
const ErmAnalyticsHeatmapPage = lazy(() => import("@/app/(dashboard)/erm/analytics/heatmap/page"));
const ErmAnalyticsBowtie = lazy(() => import("@/app/(dashboard)/erm/analytics/bowtie/page"));
const ErmAnalyticsAggregationPage = lazy(() => import("@/app/(dashboard)/erm/analytics/aggregation/page"));
const ErmAnalyticsScenarioPage = lazy(() => import("@/app/(dashboard)/erm/analytics/scenario/page"));
const ErmAnalyticsKriTriggersPage = lazy(() => import("@/app/(dashboard)/erm/analytics/kri-triggers/page"));

const DocumentsPage = lazy(() => import("@/app/(dashboard)/documents/page"));

const AssetsPage = lazy(() => import("@/app/(dashboard)/assets/page"));
const AssetDetailPage = lazy(() => import("@/app/(dashboard)/assets/[id]/page"));

const IntegrationsPage = lazy(() => import("@/app/(dashboard)/integrations/page"));
const IntegrationsConnectionsPage = lazy(() => import("@/app/(dashboard)/integrations/connections/page"));
const IntegrationsExceptionsPage = lazy(() => import("@/app/(dashboard)/integrations/exceptions/page"));

const ComplyChatPage = lazy(() => import("@/app/(dashboard)/complychat/page"));

const AdminPage = lazy(() => import("@/app/(dashboard)/admin/page"));
const AdminAuditLogsPage = lazy(() => import("@/app/(dashboard)/admin/audit-logs/page"));
const AdminOrganizationPage = lazy(() => import("@/app/(dashboard)/admin/organization/page"));
const AdminRolesPage = lazy(() => import("@/app/(dashboard)/admin/roles/page"));
const AdminUsersPage = lazy(() => import("@/app/(dashboard)/admin/users/page"));

const VulnerabilitiesPage = lazy(() => import("@/app/(dashboard)/vulnerabilities/page"));
const VulnerabilityDetailPage = lazy(() => import("@/app/(dashboard)/vulnerabilities/[id]/page"));
const VulnerabilitiesDashboardPage = lazy(() => import("@/app/(dashboard)/vulnerabilities/dashboard/page"));
const VulnerabilitiesDepartmentsPage = lazy(() => import("@/app/(dashboard)/vulnerabilities/departments/page"));
const VulnerabilitiesReportsPage = lazy(() => import("@/app/(dashboard)/vulnerabilities/reports/page"));
const VulnerabilitiesSlaPage = lazy(() => import("@/app/(dashboard)/vulnerabilities/sla/page"));

const WorkflowEnginePage = lazy(() => import("@/app/(dashboard)/workflow-engine/page"));

const IsProjectsPage = lazy(() => import("@/app/(dashboard)/is-projects/page"));
const IsProjectsDashboardPage = lazy(() => import("@/app/(dashboard)/is-projects/dashboard/page"));
const IsProjectDetailPage = lazy(() => import("@/app/(dashboard)/is-projects/[id]/page"));
const IsProjectsMyProjectsPage = lazy(() => import("@/app/(dashboard)/is-projects/my-projects/page"));

const TasksPage = lazy(() => import("@/app/(dashboard)/tasks/page"));
const TaskDetailPage = lazy(() => import("@/app/(dashboard)/tasks/[id]/page"));
const TasksMyTasksPage = lazy(() => import("@/app/(dashboard)/tasks/my-tasks/page"));
const TasksReportsPage = lazy(() => import("@/app/(dashboard)/tasks/reports/page"));
const TasksSlaPage = lazy(() => import("@/app/(dashboard)/tasks/sla/page"));

const UsersPage = lazy(() => import("@/app/(dashboard)/users/page"));

const AuditorPortalPage = lazy(() => import("@/app/(dashboard)/auditor-portal/page"));
const AuditorPortalFrameworkPage = lazy(() => import("@/app/(dashboard)/auditor-portal/[frameworkId]/page"));

const VendorRiskPage = lazy(() => import("@/app/(dashboard)/vendor-risk/page"));
const VendorRiskVendorsPage = lazy(() => import("@/app/(dashboard)/vendor-risk/vendors/page"));
const VendorRiskVendorDetailPage = lazy(() => import("@/app/(dashboard)/vendor-risk/vendors/[id]/page"));
const VendorRiskAssessmentsPage = lazy(() => import("@/app/(dashboard)/vendor-risk/assessments/page"));
const VendorRiskAssessmentDetailPage = lazy(() => import("@/app/(dashboard)/vendor-risk/assessments/[id]/page"));
const VendorRiskQuestionnairesPage = lazy(() => import("@/app/(dashboard)/vendor-risk/questionnaires/page"));

const VendorQuestionnairePage = lazy(() => import("@/app/vendor-risk/questionnaires/[token]/page"));

// Pre-created wrapped components — defined at module level so references are stable across renders
// Risks
const RisksAdvancedRoute = withRisksLayout(RisksAdvancedPage);
const RisksRcsaTemplateDetailRoute = withRisksLayout(RisksRcsaTemplateDetailPage);
const RisksRcsaTemplatesRoute = withRisksLayout(RisksRcsaTemplatesPage);
const RisksRcsaCampaignDetailRoute = withRisksLayout(RisksRcsaCampaignDetailPage);
const RisksRcsaCampaignsRoute = withRisksLayout(RisksRcsaCampaignsPage);
const RisksRcsaAssessmentDetailRoute = withRisksLayout(RisksRcsaAssessmentDetailPage);
const RisksRcsaAssessmentsRoute = withRisksLayout(RisksRcsaAssessmentsPage);
const RisksRcsaFindingDetailRoute = withRisksLayout(RisksRcsaFindingDetailPage);
const RisksRcsaFindingsRoute = withRisksLayout(RisksRcsaFindingsPage);
const RisksRcsaApprovalDetailRoute = withRisksLayout(RisksRcsaApprovalDetailPage);
const RisksRcsaApprovalsRoute = withRisksLayout(RisksRcsaApprovalsPage);
const RisksRcsaRoute = withRisksLayout(RisksRcsaPage);
const RiskDetailRoute = withRisksLayout(RiskDetailPage);
const RisksRoute = withRisksLayout(RisksPage);
// Compliance
const ComplianceStatementsRoute = withComplianceLayout(ComplianceStatementsPage);
const ComplianceAssessmentsApprovalsRoute = withComplianceLayout(ComplianceAssessmentsApprovalsPage);
const ComplianceAssessmentDetailRoute = withComplianceLayout(ComplianceAssessmentDetailPage);
const ComplianceAssessmentsRoute = withComplianceLayout(ComplianceAssessmentsPage);
const ComplianceRoute = withComplianceLayout(CompliancePage);
const CompliancePluginsPage = lazy(() => import("@/app/(dashboard)/compliance-plugins/page"));
const CompliancePluginDetailPage = lazy(() => import("@/app/(dashboard)/compliance-plugins/[id]/page"));
const CompliancePluginIngestPage = lazy(() => import("@/app/(dashboard)/compliance-plugins/ingest/page"));
const ComplianceAssetDashboardPage = lazy(() => import("@/app/(dashboard)/compliance-plugins/asset/[id]/page"));
const RiskPosturePage = lazy(() => import("@/app/(dashboard)/risk-posture/page"));
const RiskPostureAssetPage = lazy(() => import("@/app/(dashboard)/risk-posture/asset/[id]/page"));
const AgentsAdminPage = lazy(() => import("@/app/(dashboard)/admin/agents/page"));
const DiscoverPage = lazy(() => import("@/app/(dashboard)/admin/discover/page"));
const CompliancePluginsRoute = withComplianceLayout(CompliancePluginsPage);
// Framework Upload
const FrameworkUploadAlignmentRoute = withFrameworkUploadLayout(FrameworkUploadAlignmentPage);
const FrameworkUploadAssessmentRoute = withFrameworkUploadLayout(FrameworkUploadAssessmentPage);
const FrameworkUploadControlsRoute = withFrameworkUploadLayout(FrameworkUploadControlsPage);
const FrameworkUploadRoute = withFrameworkUploadLayout(FrameworkUploadPage);
// Governance
const GovernanceDocumentDetailRoute = withGovernanceLayout(GovernanceDocumentDetailPage);
const GovernanceApprovalsRoute = withGovernanceLayout(GovernanceApprovalsPage);
const GovernancePolicyAIRoute = withGovernanceLayout(GovernancePolicyAIPage);
const GovernanceDocumentsRoute = withGovernanceLayout(GovernanceDocumentsPage);
const GovernanceAttestationsRoute = withGovernanceLayout(GovernanceAttestationsPage);
const GovernanceAttestationsCampaignsRoute = withGovernanceLayout(GovernanceAttestationsCampaignsPage);
const GovernanceAttestationsCampaignDetailRoute = withGovernanceLayout(GovernanceAttestationsCampaignDetailPage);
const GovernanceAttestationsCompleteDetailRoute = withGovernanceLayout(GovernanceAttestationsCompleteDetailPage);
const GovernanceCommitteeMeetingDetailRoute = withGovernanceLayout(GovernanceCommitteeMeetingDetailPage);
const GovernanceCommitteeActionsRoute = withGovernanceLayout(GovernanceCommitteeActionsPage);
const GovernanceCommitteeDetailRoute = withGovernanceLayout(GovernanceCommitteeDetailPage);
const GovernanceCommitteesRoute = withGovernanceLayout(GovernanceCommitteesPage);
const GovernanceExceptionsRoute = withGovernanceLayout(GovernanceExceptionsPage);
const GovernanceMappingsRoute = withGovernanceLayout(GovernanceMappingsPage);
const GovernanceRegulatoryChangeDetailRoute = withGovernanceLayout(GovernanceRegulatoryChangeDetailPage);
const GovernanceRegulatoryChangesRoute = withGovernanceLayout(GovernanceRegulatoryChangesPage);
const GovernanceRegulatoryFeedsRoute = withGovernanceLayout(GovernanceRegulatoryFeedsPage);
const GovernanceReviewsCalendarRoute = withGovernanceLayout(GovernanceReviewsCalendarPage);
const GovernanceReviewsRoute = withGovernanceLayout(GovernanceReviewsPage);
const GovernanceWorkflowsRoute = withGovernanceLayout(GovernanceWorkflowsPage);
const GovernanceRoute = withGovernanceLayout(GovernancePage);
// ERM
const ErmAnalyticsHeatmapRoute = withErmLayout(ErmAnalyticsHeatmapPage);
const ErmAnalyticsBowtiRoute = withErmLayout(ErmAnalyticsBowtie);
const ErmAnalyticsAggregationRoute = withErmLayout(ErmAnalyticsAggregationPage);
const ErmAnalyticsScenarioRoute = withErmLayout(ErmAnalyticsScenarioPage);
const ErmAnalyticsKriTriggersRoute = withErmLayout(ErmAnalyticsKriTriggersPage);
const ErmAnalyticsRoute = withErmLayout(ErmAnalyticsPage);
const ErmRisksRoute = withErmLayout(ErmRisksPage);
const ErmKrisRoute = withErmLayout(ErmKrisPage);
const ErmAppetiteRoute = withErmLayout(ErmAppetitePage);
const ErmDependenciesRoute = withErmLayout(ErmDependenciesPage);
const ErmIncidentsRoute = withErmLayout(ErmIncidentsPage);
const ErmInternalControlDetailRoute = withErmLayout(ErmInternalControlDetailPage);
const ErmInternalControlsRoute = withErmLayout(ErmInternalControlsPage);
const ErmMitigationActionsRoute = withErmLayout(ErmMitigationActionsPage);
const ErmRcsaRoute = withErmLayout(ErmRcsaPage);
const ErmReportsRoute = withErmLayout(ErmReportsPage);
const ErmReviewsRoute = withErmLayout(ErmReviewsPage);
const ErmRiskAssessmentsFrameworkDetailRoute = withErmLayout(ErmRiskAssessmentsFrameworkDetailPage);
const ErmRiskAssessmentsFrameworkRoute = withErmLayout(ErmRiskAssessmentsFrameworkPage);
const ErmRiskAssessmentDetailRoute = withErmLayout(ErmRiskAssessmentDetailPage);
const ErmRiskAssessmentsRoute = withErmLayout(ErmRiskAssessmentsPage);
const ErmRoute = withErmLayout(ErmPage);
// Vendor Risk
const VendorRiskVendorDetailRoute = withVendorRiskLayout(VendorRiskVendorDetailPage);
const VendorRiskVendorsRoute = withVendorRiskLayout(VendorRiskVendorsPage);
const VendorRiskAssessmentDetailRoute = withVendorRiskLayout(VendorRiskAssessmentDetailPage);
const VendorRiskAssessmentsRoute = withVendorRiskLayout(VendorRiskAssessmentsPage);
const VendorRiskQuestionnairesRoute = withVendorRiskLayout(VendorRiskQuestionnairesPage);
const VendorRiskRoute = withVendorRiskLayout(VendorRiskPage);

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then((r) => r.data),
    retry: false,
    staleTime: 30 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <LoadingSpinner />;
  if (isError || !data?.user) return <Redirect to="/login" />;
  return <>{children}</>;
}

function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="platform-ui compact-density cw-dashboard flex h-screen overflow-hidden bg-[var(--color-subtle)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto bg-[var(--color-subtle)] p-4 lg:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}

function DashboardRoutes() {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/dashboard" component={DashboardPage} />

          {/* Risks — nested RisksLayout */}
          <Route path="/risks/advanced" component={RisksAdvancedRoute} />
          <Route path="/risks/rcsa/templates/:id" component={RisksRcsaTemplateDetailRoute} />
          <Route path="/risks/rcsa/templates" component={RisksRcsaTemplatesRoute} />
          <Route path="/risks/rcsa/campaigns/:id" component={RisksRcsaCampaignDetailRoute} />
          <Route path="/risks/rcsa/campaigns" component={RisksRcsaCampaignsRoute} />
          <Route path="/risks/rcsa/assessments/:id" component={RisksRcsaAssessmentDetailRoute} />
          <Route path="/risks/rcsa/assessments" component={RisksRcsaAssessmentsRoute} />
          <Route path="/risks/rcsa/findings/:id" component={RisksRcsaFindingDetailRoute} />
          <Route path="/risks/rcsa/findings" component={RisksRcsaFindingsRoute} />
          <Route path="/risks/rcsa/approvals/:id" component={RisksRcsaApprovalDetailRoute} />
          <Route path="/risks/rcsa/approvals" component={RisksRcsaApprovalsRoute} />
          <Route path="/risks/rcsa" component={RisksRcsaRoute} />
          <Route path="/risks/:id" component={RiskDetailRoute} />
          <Route path="/risks" component={RisksRoute} />

          {/* Compliance — nested ComplianceLayout */}
          <Route path="/compliance/statements" component={ComplianceStatementsRoute} />
          <Route path="/compliance/assessments/approvals" component={ComplianceAssessmentsApprovalsRoute} />
          <Route path="/compliance/assessments/:id" component={ComplianceAssessmentDetailRoute} />
          <Route path="/compliance/assessments" component={ComplianceAssessmentsRoute} />
          <Route path="/compliance/plugins/ingest" component={withComplianceLayout(CompliancePluginIngestPage)} />
          <Route path="/compliance/plugins/asset/:id" component={withComplianceLayout(ComplianceAssetDashboardPage)} />
          <Route path="/risk-posture/asset/:id" component={RiskPostureAssetPage} />
          <Route path="/risk-posture" component={RiskPosturePage} />
          <Route path="/admin/agents" component={AgentsAdminPage} />
          <Route path="/admin/discover" component={DiscoverPage} />
          <Route path="/compliance/plugins/:id" component={withComplianceLayout(CompliancePluginDetailPage)} />
          <Route path="/compliance/plugins" component={CompliancePluginsRoute} />
          <Route path="/compliance" component={ComplianceRoute} />

          {/* Controls */}
          <Route path="/controls" component={ControlsPage} />

          {/* Control Library */}
          <Route path="/control-library/evidence" component={ControlLibraryEvidencePage} />
          <Route path="/control-library/gaps" component={ControlLibraryGapsPage} />
          <Route path="/control-library/compare" component={ControlLibraryComparePage} />
          <Route path="/control-library/:id" component={ControlLibraryDetailPage} />
          <Route path="/control-library" component={ControlLibraryPage} />

          {/* Frameworks */}
          <Route path="/frameworks/overview/:id" component={FrameworksOverviewDetailPage} />
          <Route path="/frameworks/:id" component={FrameworkDetailPage} />
          <Route path="/frameworks" component={FrameworksPage} />

          {/* Framework Upload — nested FrameworkUploadLayout */}
          <Route path="/framework-upload/alignment" component={FrameworkUploadAlignmentRoute} />
          <Route path="/framework-upload/assessment" component={FrameworkUploadAssessmentRoute} />
          <Route path="/framework-upload/controls" component={FrameworkUploadControlsRoute} />
          <Route path="/framework-upload" component={FrameworkUploadRoute} />

          {/* Governance — nested GovernanceLayout */}
          <Route path="/governance/approvals" component={GovernanceApprovalsRoute} />
          <Route path="/governance/policy-ai" component={GovernancePolicyAIRoute} />
          <Route path="/governance/documents/:id" component={GovernanceDocumentDetailRoute} />
          <Route path="/governance/documents" component={GovernanceDocumentsRoute} />
          <Route path="/governance/attestations/campaigns/:id" component={GovernanceAttestationsCampaignDetailRoute} />
          <Route path="/governance/attestations/campaigns" component={GovernanceAttestationsCampaignsRoute} />
          <Route path="/governance/attestations/complete/:id" component={GovernanceAttestationsCompleteDetailRoute} />
          <Route path="/governance/attestations" component={GovernanceAttestationsRoute} />
          <Route path="/governance/committees/meetings/:id" component={GovernanceCommitteeMeetingDetailRoute} />
          <Route path="/governance/committees/actions" component={GovernanceCommitteeActionsRoute} />
          <Route path="/governance/committees/:id" component={GovernanceCommitteeDetailRoute} />
          <Route path="/governance/committees" component={GovernanceCommitteesRoute} />
          <Route path="/governance/exceptions" component={GovernanceExceptionsRoute} />
          <Route path="/governance/mappings" component={GovernanceMappingsRoute} />
          <Route path="/governance/regulatory-changes/:id" component={GovernanceRegulatoryChangeDetailRoute} />
          <Route path="/governance/regulatory-changes" component={GovernanceRegulatoryChangesRoute} />
          <Route path="/governance/regulatory-feeds" component={GovernanceRegulatoryFeedsRoute} />
          <Route path="/governance/reviews/calendar" component={GovernanceReviewsCalendarRoute} />
          <Route path="/governance/reviews" component={GovernanceReviewsRoute} />
          <Route path="/governance/workflows" component={GovernanceWorkflowsRoute} />
          <Route path="/governance" component={GovernanceRoute} />

          {/* Evidence */}
          <Route path="/evidence/audit-packages" component={EvidenceAuditPackagesPage} />
          <Route path="/evidence/:id" component={EvidenceDetailPage} />
          <Route path="/evidence" component={EvidencePage} />
          <Route path="/evidence-requirements" component={EvidenceRequirementsPage} />

          {/* Audit */}
          <Route path="/audit/engagements/:id" component={AuditEngagementDetailPage} />
          <Route path="/audit/engagements" component={AuditEngagementsPage} />
          <Route path="/audit/findings/:id" component={AuditFindingDetailPage} />
          <Route path="/audit/findings" component={AuditFindingsPage} />
          <Route path="/audit/plans/:id" component={AuditPlanDetailPage} />
          <Route path="/audit/plans" component={AuditPlansPage} />
          <Route path="/audit/universe/:id" component={AuditUniverseDetailPage} />
          <Route path="/audit/universe" component={AuditUniversePage} />
          <Route path="/audit/capacity" component={AuditCapacityPage} />
          <Route path="/audit/ccm" component={AuditCcmPage} />
          <Route path="/audit/qaip" component={AuditQaipPage} />
          <Route path="/audit/reporting" component={AuditReportingPage} />
          <Route path="/audit/skill-matrix" component={AuditSkillMatrixPage} />
          <Route path="/audit/test-scripts" component={AuditTestScriptsPage} />
          <Route path="/audit/notifications" component={AuditNotificationsPage} />
          <Route path="/audit" component={AuditPage} />

          {/* ERM — nested ErmLayout */}
          <Route path="/erm/risks" component={ErmRisksRoute} />
          <Route path="/erm/analytics/heatmap" component={ErmAnalyticsHeatmapRoute} />
          <Route path="/erm/analytics/bowtie" component={ErmAnalyticsBowtiRoute} />
          <Route path="/erm/analytics/aggregation" component={ErmAnalyticsAggregationRoute} />
          <Route path="/erm/analytics/scenario" component={ErmAnalyticsScenarioRoute} />
          <Route path="/erm/analytics/kri-triggers" component={ErmAnalyticsKriTriggersRoute} />
          <Route path="/erm/analytics" component={ErmAnalyticsRoute} />
          <Route path="/erm/kris" component={ErmKrisRoute} />
          <Route path="/erm/appetite" component={ErmAppetiteRoute} />
          <Route path="/erm/dependencies" component={ErmDependenciesRoute} />
          <Route path="/erm/incidents" component={ErmIncidentsRoute} />
          <Route path="/erm/internal-controls/:id" component={ErmInternalControlDetailRoute} />
          <Route path="/erm/internal-controls" component={ErmInternalControlsRoute} />
          <Route path="/erm/mitigation-actions" component={ErmMitigationActionsRoute} />
          <Route path="/erm/rcsa" component={ErmRcsaRoute} />
          <Route path="/erm/reports" component={ErmReportsRoute} />
          <Route path="/erm/reviews" component={ErmReviewsRoute} />
          <Route path="/erm/risk-assessments/framework/:id" component={ErmRiskAssessmentsFrameworkDetailRoute} />
          <Route path="/erm/risk-assessments/framework" component={ErmRiskAssessmentsFrameworkRoute} />
          <Route path="/erm/risk-assessments/:id" component={ErmRiskAssessmentDetailRoute} />
          <Route path="/erm/risk-assessments" component={ErmRiskAssessmentsRoute} />
          <Route path="/erm" component={ErmRoute} />

          {/* Documents */}
          <Route path="/documents" component={DocumentsPage} />

          {/* Assets */}
          <Route path="/assets/:id" component={AssetDetailPage} />
          <Route path="/assets" component={AssetsPage} />

          {/* Integrations */}
          <Route path="/integrations/connect" component={ConnectWizard} />
          <Route path="/integrations/connections" component={IntegrationsConnectionsPage} />
          <Route path="/integrations/exceptions" component={IntegrationsExceptionsPage} />
          <Route path="/integrations" component={IntegrationsPage} />

          {/* Admin → also expose the Connect Wizard here so a tenant admin
              can open it from the Admin menu. The route mounts the same
              component, just under the /admin namespace for discoverability. */}
          <Route path="/admin/integrations/connect" component={ConnectWizard} />

          {/* Vendor Risk — nested VendorRiskLayout */}
          <Route path="/vendor-risk/vendors/:id" component={VendorRiskVendorDetailRoute} />
          <Route path="/vendor-risk/vendors" component={VendorRiskVendorsRoute} />
          <Route path="/vendor-risk/assessments/:id" component={VendorRiskAssessmentDetailRoute} />
          <Route path="/vendor-risk/assessments" component={VendorRiskAssessmentsRoute} />
          <Route path="/vendor-risk/questionnaires" component={VendorRiskQuestionnairesRoute} />
          <Route path="/vendor-risk" component={VendorRiskRoute} />

          {/* Vulnerabilities */}
          <Route path="/vulnerabilities/dashboard" component={VulnerabilitiesDashboardPage} />
          <Route path="/vulnerabilities/departments" component={VulnerabilitiesDepartmentsPage} />
          <Route path="/vulnerabilities/reports" component={VulnerabilitiesReportsPage} />
          <Route path="/vulnerabilities/sla" component={VulnerabilitiesSlaPage} />
          <Route path="/vulnerabilities/:id" component={VulnerabilityDetailPage} />
          <Route path="/vulnerabilities" component={VulnerabilitiesPage} />

          {/* Workflow Engine */}
          <Route path="/workflow-engine" component={WorkflowEnginePage} />

          {/* IS Projects */}
          <Route path="/is-projects/dashboard" component={IsProjectsDashboardPage} />
          <Route path="/is-projects/my-projects" component={IsProjectsMyProjectsPage} />
          <Route path="/is-projects/:id" component={IsProjectDetailPage} />
          <Route path="/is-projects" component={IsProjectsPage} />

          {/* Tasks */}
          <Route path="/tasks/my-tasks" component={TasksMyTasksPage} />
          <Route path="/tasks/reports" component={TasksReportsPage} />
          <Route path="/tasks/sla" component={TasksSlaPage} />
          <Route path="/tasks/:id" component={TaskDetailPage} />
          <Route path="/tasks" component={TasksPage} />

          {/* Users */}
          <Route path="/users" component={UsersPage} />

          {/* Auditor Portal */}
          <Route path="/auditor-portal/:frameworkId" component={AuditorPortalFrameworkPage} />
          <Route path="/auditor-portal" component={AuditorPortalPage} />

          {/* ComplyChat */}
          <Route path="/complychat" component={ComplyChatPage} />

          {/* Admin */}
          <Route path="/admin/audit-logs" component={AdminAuditLogsPage} />
          <Route path="/admin/organization" component={AdminOrganizationPage} />
          <Route path="/admin/roles" component={AdminRolesPage} />
          <Route path="/admin/users" component={AdminUsersPage} />
          <Route path="/admin" component={AdminPage} />

          {/* Fallback */}
          <Route>
            <Redirect to="/dashboard" />
          </Route>
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Suspense fallback={<LoadingSpinner />}>
          <LandingPage />
        </Suspense>
      </Route>
      <Route path="/welcome">
        <AuthGuard>
          <Suspense fallback={<LoadingSpinner />}>
            <WelcomePage />
          </Suspense>
        </AuthGuard>
      </Route>
      <Route path="/onboarding/connect">
        <AuthGuard>
          <Suspense fallback={<LoadingSpinner />}>
            <ConnectWizard />
          </Suspense>
        </AuthGuard>
      </Route>
      <Route path="/landing">
        <AuthGuard>
          <Suspense fallback={<LoadingSpinner />}>
            <AppLandingPage />
          </Suspense>
        </AuthGuard>
      </Route>
      <Route path="/login">
        <Suspense fallback={<LoadingSpinner />}>
          <LoginPage />
        </Suspense>
      </Route>
      <Route path="/register">
        <Suspense fallback={<LoadingSpinner />}>
          <RegisterPage />
        </Suspense>
      </Route>
      <Route path="/vendor-risk/questionnaires/:token">
        <Suspense fallback={<LoadingSpinner />}>
          <VendorQuestionnairePage />
        </Suspense>
      </Route>
      <Route>
        <AuthGuard>
          <DashboardRoutes />
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
