'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { certificationsApi, governanceApi, frameworkTemplatesApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { CertificationJourney, CertificationControl } from '@/types';
import { ErrorState, Skeleton, SkeletonRows, TabPanel, Tabs, useTabParam } from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import ArtifactsTab from '@/components/compliance/ArtifactsTab';
import FrameworkRegisterTab from '../_tabs/FrameworkRegisterTab';
import FrameworkDocumentTab from '../_tabs/FrameworkDocumentTab';
import FrameworkDynamicRegisterTab from '../_tabs/FrameworkDynamicRegisterTab';
import PciCdeInventoryTab from '../_tabs/_PciCdeInventoryTab';
import HipaaEphiInventoryTab from '../_tabs/_HipaaEphiInventoryTab';
import { orderRegisters, orderDocuments } from '../_tabs/templateSequence';
import { matchFrameworkFlow } from '../_data/frameworkFlows';
import {
  aliasesFor, journeyNumbers, journeyTabKeys, landingTab, openItem, recentActivity, requirementCount, TAB_ALIASES, waitingForMe, type ScopeRecordLite,
} from '@/lib/journeyModel';
import { RequirementsTab } from '../_requirements/RequirementsTab';
import { useCriteriaTicks } from '../_requirements/useCriteriaTicks';
import JourneyHeader from './JourneyHeader';
import JourneyHome from './JourneyHome';
import OverviewTab from './OverviewTab';
import ScopeTab, { type ScopeRecord } from './ScopeTab';
import ActivityTab from './ActivityTab';
import RegistersHost, { type RegisterItem } from './RegistersHost';

/** The journey page: loads the journey, says so when it cannot, and hands the loaded journey to the body (whose hooks need it). */
export default function JourneyWorkspace({ journeyId }: { journeyId: number }) {
  const { data: journey, isLoading, error, refetch } = useQuery({
    queryKey: ['certification', journeyId],
    queryFn: async () => (await certificationsApi.getById(journeyId)).data as CertificationJourney,
    enabled: Number.isFinite(journeyId),
    // a journey that does not exist (404) or that the person may not open (403) is answered once; a failed connection is tried again twice
    retry: (failureCount, err: any) => !(err?.response?.status >= 400 && err?.response?.status < 500) && failureCount < 2,
  });
  if (!Number.isFinite(journeyId)) {
    return <ErrorState title="This framework journey does not exist" message="The address is not a journey. Open the frameworks list and pick one." />;
  }
  if (isLoading) {
    return (
      <div className="space-y-[16px]" aria-busy="true">
        <Skeleton className="h-[32px] w-1/3" />
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4"><Skeleton className="h-[96px]" /><Skeleton className="h-[96px]" /><Skeleton className="h-[96px]" /><Skeleton className="h-[96px]" /></div>
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (error || !journey) {
    return <ErrorState title="Couldn't load this framework journey" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={() => { void refetch(); }} />;
  }
  return <JourneyBody key={journeyId} journey={journey} journeyId={journeyId} />;
}

function JourneyBody({ journey, journeyId }: { journey: CertificationJourney; journeyId: number }) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('frameworks:framework_library:create');
  const canEdit = hasPermission('frameworks:framework_library:edit');
  const canDelete = hasPermission('frameworks:framework_library:delete');

  // The requirement that is open in the drawer of the Requirements tab (`?req=<id>`). The page holds it so the other tabs (a requirement waiting for me, the roadmap) can open one.
  const [openId, setOpenId] = useState<number | null>(null);
  const spineAutoOpenedFor = useRef<number | null>(null);

  // The ticks of the checklists: the Requirements tab draws them and the Overview's roadmap reads the same unsaved ones.
  const criteria = useCriteriaTicks(journeyId);

  const { data: controls, isLoading: controlsLoading, error: controlsError, refetch: refetchControls } = useQuery({
    queryKey: ['certification-controls', journeyId],
    queryFn: async () => (await certificationsApi.getControls(journeyId)).data as CertificationControl[],
  });

  // The journey's numbers: the detail payload already carries them (one server pass), so there is no request of its own on open; a mutation that
  // changes them invalidates this key and they are read again.
  const { data: progress } = useQuery({
    queryKey: ['certification-progress', journeyId],
    queryFn: async () => (await certificationsApi.getProgress(journeyId)).data as any,
    initialData: (journey as any).progress,
    staleTime: Infinity,
  });
  const numbers = journeyNumbers(progress);

  // Per-requirement assignment: current-user id (for "waiting for me") and the tenant's users.
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { authedFetch } = await import('@/lib/auth-fetch');
        const res = await authedFetch('/api/auth/me');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.authenticated && data.user?.id) setCurrentUserId(Number(data.user.id));
      } catch {
        /* non-fatal: "waiting for me" then lists nothing of the person's own */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { data: assignmentTenantUsers } = useQuery({
    queryKey: ['certification-tenant-users', journeyId],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data,
  });

  const frameworkClassification = ((journey as any)?.framework_classification || '').toLowerCase();
  const fallbackName = (((journey as any)?.framework_name || journey?.framework?.name || '') as string).toLowerCase();
  const isCertificationFramework = frameworkClassification
    ? frameworkClassification === 'certification'
    : (fallbackName.includes('iso') || fallbackName.includes('pci'));
  const entityLabelPlural = isCertificationFramework ? 'Controls' : 'Requirements';

  // Applicability is keyed by the UPLOADED framework id. For flat/uploaded frameworks (NDMO) journey.framework_id is null and
  // uploaded_framework_id carries the real id.
  const appFwId: number | null = (journey as any)?.uploaded_framework_id ?? (journey as any)?.framework_id ?? null;

  // Scope decisions of this framework: one request; it feeds the Scope tab, its badge, "waiting for me", the recent activity and the Requirements drawer.
  const scopeQuery = useQuery({
    queryKey: ['applicability', appFwId],
    queryFn: async () => (await governanceApi.getFrameworkApplicability(appFwId as number)).data as { records: ScopeRecord[] },
    enabled: !!appFwId,
  });
  const records: ScopeRecord[] = scopeQuery.data?.records ?? [];

  const isIso27001Framework = (() => {
    const norm = (((journey as any)?.framework_name || journey?.framework?.name || journey?.name || '') as string).toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm.includes('27001') && norm.includes('iso');
  })();
  const templateTenantUsers = useMemo(
    () => (assignmentTenantUsers || []).map((u: any) => ({ id: u.id, name: u.display_name || u.email || String(u.id) })),
    [assignmentTenantUsers]
  );
  const templateFrameworkControls = useMemo(
    () => ((controls as any[]) || [])
      .map((c: any) => ({ code: c.control_code || c.original_reference || '', title: c.control_name || c.title || '' }))
      .filter((c: any) => c.code),
    [controls]
  );
  const templateFrameworkName = (((journey as any)?.framework_name || journey?.framework?.name || journey?.name || '') as string);
  // Canonical end-to-end journey flow for this framework, if one is mapped: it adds the Journey tab.
  const journeyFlow = useMemo(() => matchFrameworkFlow(templateFrameworkName), [templateFrameworkName]);
  const { data: fwTemplateDef, isLoading: fwTemplateLoading } = useQuery({
    queryKey: ['ft-definition', templateFrameworkName],
    queryFn: async () => (await frameworkTemplatesApi.definition(templateFrameworkName)).data as {
      matched: boolean;
      display_name?: string;
      registers: Array<{ type: string; label: string; description?: string; columns: any[]; formSections?: any[]; assetSource?: string }>;
      documents: Array<{ type: string; label: string; control_ref?: string | null }>;
    },
    enabled: !!templateFrameworkName,
  });

  // The framework's own registers and documents, listed stage-wise (templateSequence), live behind the one Registers tab.
  const registerItems: RegisterItem[] = useMemo(() => [
    ...orderRegisters([
      ...(isIso27001Framework ? [
        { id: 'gap-analysis', label: 'Gap Analysis' },
        { id: 'internal-audit', label: 'Internal Audit' },
        { id: 'risk-treatment', label: 'Risk Treatment' },
      ] : []),
      ...(fwTemplateDef?.registers || []).map((r) => ({ id: r.type, label: r.label })),
    ]).map((t) => ({ id: String(t.id), label: t.label, kind: 'register' as const })),
    ...orderDocuments([
      ...(isIso27001Framework ? [
        { id: 'scope-statement', label: 'Scope Statement' },
        { id: 'audit-procedure', label: 'Audit Procedure' },
      ] : []),
      ...(fwTemplateDef?.documents || []).map((d) => ({ id: d.type, label: d.label })),
    ]).map((t) => ({ id: String(t.id), label: t.label, kind: 'document' as const })),
  ], [isIso27001Framework, fwTemplateDef]);
  const templateKeys = useMemo(() => registerItems.map((i) => i.id), [registerItems]);

  // ── the tabs: kit Tabs, the open one kept in the address (?tab=), every old address still opens the tab that holds its content ──
  const hasFlow = !!journeyFlow;
  const tabKeys = journeyTabKeys({ hasFlow, templateKeys });
  const [tab, setTab] = useTabParam<string>('tab', tabKeys, { fallback: landingTab(hasFlow), aliases: aliasesFor(templateKeys) });
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const item = openItem(search, templateKeys);
  const setItem = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'registers');
    url.searchParams.set('item', id);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
  };

  /**
   * Open a requirement in the drawer of the Requirements tab, from any tab, AND mirror that into the URL as `?req=<id>` (with `?tab=controls`). Critical for back-from-evidence-detail:
   * `router.back()` inside /evidence/[id] returns to /frameworks/<fwId>?req=<reqId> and the page re-opens the drawer on the same requirement. Closing it takes `req` out of the address
   * with replaceState, so nothing remounts.
   */
  const openRequirement = (id: number | null) => {
    setOpenId(id);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (id !== null) {
      url.searchParams.set('req', String(id));
      url.searchParams.set('tab', 'controls');
      if (tab !== 'controls') {
        // from another tab: go to the Requirements tab and carry `req` in the same navigation
        setTab('controls');
        router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
      } else {
        // already there (a row, previous / next): the address follows at once, with no round trip to the server
        window.history.replaceState({}, '', url.toString());
      }
    } else {
      url.searchParams.delete('req');
      window.history.replaceState({}, '', url.toString());
    }
  };

  // `?req=<id>` in the address (a link from My Work, or the Back button from an evidence page) opens the drawer once the list is here.
  useEffect(() => {
    if (typeof window === 'undefined' || !controls || controls.length === 0) return;
    const reqRaw = new URL(window.location.href).searchParams.get('req');
    if (!reqRaw) return;
    const reqId = Number(reqRaw);
    if (!Number.isFinite(reqId) || spineAutoOpenedFor.current === reqId) return;
    const match = (controls as CertificationControl[]).find((c) => c.id === reqId || c.parsed_control_id === reqId);
    if (!match) return;
    spineAutoOpenedFor.current = reqId;
    setTab('controls');
    setOpenId(match.id);
  }, [controls]);

  // Snapshots (Activity tab and the recent-activity line of the Journey tab).
  const { data: snapshots, isLoading: snapshotsLoading, error: snapshotsError, refetch: refetchSnapshots } = useQuery({
    queryKey: ['compliance-snapshots', journeyId],
    queryFn: async () => (await apiClient.get(`/certifications/${journeyId}/snapshots`)).data as Array<{
      id: number; year: number | null; label: string | null; captured_at: string | null; overall_pct: number; compliant_count: number; total_count: number;
      breakdown: { tiers?: Record<string, { total: number; compliant: number; avg: number }>; domains?: Array<{ domain: string; total: number; compliant: number; avg: number }> };
      notes: string | null;
    }>,
  });

  const waiting = waitingForMe({ controls, userId: currentUserId, canReview: canEdit, records: records as ScopeRecordLite[] });
  const activity = recentActivity({ records, snapshots, limit: 5 });
  // "Need you" is a number only when what it counts has been read: the person is known and the requirements (and, for a reviewer, the scope decisions) are here.
  const waitingKnown = !!controls && !controlsError && currentUserId !== null && (!canEdit || !appFwId || (!scopeQuery.isLoading && !scopeQuery.error));
  const waitingTotal = waitingKnown ? waiting.total : null;

  // The registers/documents tab is addressed by an old ?tab=<type>: until the template definition is here, show a loader, not the landing tab.
  const rawTab = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('tab') || '';
  const waitingForTemplates = fwTemplateLoading && !!rawTab && tabKeys.indexOf(rawTab) < 0 && !Object.prototype.hasOwnProperty.call(TAB_ALIASES, rawTab);

  const renderRegisterItem = (id: string) => {
    const dynReg = (fwTemplateDef?.registers || []).find((r) => r.type === id);
    if (dynReg) {
      // Asset-backed inventory (PCI CDE / HIPAA ePHI) -> dedicated Assets CRUD tab; everything else -> the generic dynamic register table.
      if (dynReg.assetSource === 'ephi') return <HipaaEphiInventoryTab journeyId={journeyId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers as any} />;
      if (dynReg.assetSource === 'cde') return <PciCdeInventoryTab journeyId={journeyId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers as any} />;
      return <FrameworkDynamicRegisterTab config={dynReg} journeyId={journeyId} frameworkId={appFwId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
    }
    const dynDoc = (fwTemplateDef?.documents || []).find((d) => d.type === id);
    if (dynDoc) return <FrameworkDocumentTab docType={dynDoc.type} journeyId={journeyId} frameworkId={appFwId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers} />;
    const isoName = (journey as any)?.framework_name || 'ISO 27001';
    switch (id) {
      case 'gap-analysis':
        return <FrameworkRegisterTab registerType="gap_analysis" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
      case 'internal-audit':
        return <FrameworkRegisterTab registerType="internal_audit" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
      case 'risk-treatment':
        return <FrameworkRegisterTab registerType="risk_treatment" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
      case 'scope-statement':
        return <FrameworkDocumentTab docType="isms_scope_statement" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} />;
      case 'audit-procedure':
        return <FrameworkDocumentTab docType="internal_audit_procedure" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} />;
      default:
        return null;
    }
  };

  const scopePending = records.filter((r) => r.status === 'pending').length;
  const tabItems = tabKeys.map((key) => {
    switch (key) {
      case 'journey': return { key, label: 'Journey' };
      case 'overview': return { key, label: 'Overview' };
      case 'controls': return { key, label: 'Requirements', count: controls ? requirementCount(controls) : undefined };
      case 'scope': return { key, label: 'Scope & decisions', count: scopePending || undefined };
      case 'registers': return { key, label: 'Registers' };
      case 'artifacts': return { key, label: 'Artifacts' };
      default: return { key, label: 'Activity' };
    }
  });
  const tenantUsersForArtifacts = (assignmentTenantUsers || []).map((u: any) => ({ id: u.id, label: u.display_name || u.email || String(u.id), email: u.email }));
  const frameworkLabel = (journey as any)?.framework_name || journey?.name || '';

  return (
    <div className="flex flex-col gap-[16px]">
      <JourneyHeader journeyId={journeyId} journey={journey} numbers={numbers} waitingTotal={waitingTotal} isCertification={isCertificationFramework} />

      {waitingForTemplates ? (
        <SkeletonRows rows={4} />
      ) : (
        <Tabs tabs={tabItems} value={tab} onChange={setTab} ariaLabel="Framework journey sections" countFormat="exact">
          {hasFlow && (
            <TabPanel tabKey="journey" lazy className="pt-[16px]">
              <JourneyHome
                journeyId={journeyId}
                flow={journeyFlow}
                stageOwners={(journey as any)?.stage_owners}
                frameworkId={appFwId}
                frameworkName={templateFrameworkName}
                waiting={waiting}
                controlsLoading={controlsLoading}
                controlsFailed={!!controlsError}
                scopeLoading={scopeQuery.isLoading}
                scopeFailed={!!scopeQuery.error}
                activity={activity}
                numbers={numbers}
                onOpenRequirement={(c: CertificationControl) => openRequirement(c.id)}
                goTab={setTab}
                entityLabelPlural={entityLabelPlural}
              />
            </TabPanel>
          )}
          <TabPanel tabKey="overview" lazy className="pt-[16px]">
            <OverviewTab
              journeyId={journeyId}
              journey={journey}
              controls={controls}
              numbers={numbers}
              canEdit={canEdit}
              isCertification={isCertificationFramework}
              entityLabelPlural={entityLabelPlural}
              criteriaState={criteria.criteriaState}
              onOpenRequirement={(c: CertificationControl) => openRequirement(c.id)}
              showWaiting={!hasFlow}
              waiting={waiting}
              controlsLoading={controlsLoading}
              controlsFailed={!!controlsError}
              scopeLoading={scopeQuery.isLoading}
              scopeFailed={!!scopeQuery.error}
              activity={activity}
              goTab={setTab}
            />
          </TabPanel>
          <TabPanel tabKey="controls" lazy className="pt-[16px]">
            <RequirementsTab
              journeyId={journeyId}
              journey={journey as any}
              frameworkLabel={frameworkLabel}
              entityLabelPlural={entityLabelPlural}
              controls={controls}
              loading={controlsLoading}
              error={controlsError}
              onRetry={() => { void refetchControls(); }}
              users={assignmentTenantUsers}
              currentUserId={currentUserId}
              appFwId={appFwId}
              records={records}
              scopeLoading={scopeQuery.isLoading}
              scopeError={scopeQuery.error}
              onScopeRetry={() => { void scopeQuery.refetch(); }}
              rights={{ canCreate, canEdit, canDelete }}
              openId={openId}
              onOpen={openRequirement}
              criteria={criteria}
              active={tab === 'controls'}
              onGoScope={() => setTab('scope')}
            />
          </TabPanel>
          <TabPanel tabKey="scope" lazy className="pt-[16px]">
            <ScopeTab
              journeyId={journeyId}
              appFwId={appFwId}
              records={records}
              loading={scopeQuery.isLoading}
              error={scopeQuery.error}
              onRetry={() => { void scopeQuery.refetch(); }}
              controls={controls}
              canEdit={canEdit}
              users={templateTenantUsers}
            />
          </TabPanel>
          {templateKeys.length > 0 && (
            <TabPanel tabKey="registers" lazy className="pt-[16px]">
              <RegistersHost items={registerItems} open={item} onOpen={setItem} render={renderRegisterItem} label={fwTemplateDef?.display_name || templateFrameworkName} />
            </TabPanel>
          )}
          <TabPanel tabKey="artifacts" lazy className="pt-[16px]">
            <ArtifactsTab assessmentType={(journey as any)?.framework_name || journey?.name || ''} tenantUsers={tenantUsersForArtifacts} />
          </TabPanel>
          <TabPanel tabKey="activity" lazy className="pt-[16px]">
            <ActivityTab
              journeyId={journeyId}
              snapshots={snapshots}
              loading={snapshotsLoading}
              error={snapshotsError}
              onRetry={() => { void refetchSnapshots(); }}
              activity={activity}
              scopeFailed={!!scopeQuery.error}
              goTab={setTab}
            />
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}
