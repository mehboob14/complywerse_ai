'use client';

// The Control Catalog (/controls): the compliance workbench for the controls an organisation works. The page draws its head, the strip it shares with the Library and Assurance, the switch between framework
// controls and internal controls, the four views (By domain, By framework, All controls, My work) and the sheets (a control, a new internal control, Add from the Library). Its state is in the address
// (catalogAddress.ts): /controls?mode=internal, /controls?framework=<id> (the Frameworks pages' "View requirements"), /controls?promote=1 (the Library's "Promote to Catalog") all open what they say.
// What each number means is catalogModel.ts; the requests are catalogData.ts. Nothing here changes who may do what: the Catalog's routes ask only for a signed-in person, and only the scope is admin's.
import { useCallback, useId, useMemo, useState } from 'react';
import { Plus, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, Notice, SegmentedControl, TabPanel, Tabs, useAddressState, useConfirm, useReportedMutation } from '@/components/ui/ds';
import ControlSurfaceTabs from '@/components/dashboard/ControlSurfaceTabs';
import apiClient from '@/lib/api';
import { formatCount } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { CATALOG_SCHEMA, attentionPatch, filterPatch, modePatch, openDomainPatch, pageOf, viewPatch } from './catalogAddress';
import { WB, useMyWork, useOverview, useScope } from './catalogData';
import type { CatalogMode, CatalogRow, CatalogView } from './catalogModel';
import { NewControlSheet, PromoteSheet } from './CatalogSheets';
import { ControlDrawer } from './ControlDrawer';
import { DomainHub } from './DomainHub';
import { DomainDetail, FrameworkView } from './GroupViews';
import { AllControls, InternalView, MyWorkView } from './ListViews';

export function CatalogPage() {
  const uid = useId();
  const { confirm, confirmDialog } = useConfirm();
  const [address, setAddress] = useAddressState(CATALOG_SCHEMA);
  const page = useMemo(() => pageOf(address), [address]);
  const ovQ = useOverview();
  const scopeQ = useScope();
  const mine = useMyWork();
  const [open, setOpen] = useState<CatalogRow | null>(null);
  const [creating, setCreating] = useState(false);
  const ov = ovQ.data;
  const scope = scopeQ.data;
  const label = routeFor('/controls')?.label ?? 'Control Catalog';
  const internal = page.mode === 'internal';

  const clearScope = useReportedMutation({
    mutationFn: () => apiClient.put(`${WB}/scope`, { framework_ids: [] }),
    success: { title: 'The Catalog shows every framework', message: 'Its controls are back in the lists.' },
    failure: "Couldn't clear the framework scope",
    invalidate: [['wb-scope'], ['wb-overview'], ['wb-list'], ['wb-domains'], ['wb-groups']],
  });
  const askClearScope = async () => {
    const ok = await confirm({
      title: 'Show the controls of every framework?',
      message: `The Catalog is limited to ${formatCount(scope?.framework_ids.length)} ${scope?.framework_ids.length === 1 ? 'framework' : 'frameworks'}. This changes it for everyone in your organisation.`,
      confirmLabel: 'Show every framework',
    });
    if (ok) clearScope.mutate();
  };

  const closePromote = useCallback(() => setAddress({ promote: false }), [setAddress]);
  const nFrameworks = scope?.framework_ids.length ?? 0;
  const meta = ov ? `${formatCount(ov.totals.controls)} framework ${ov.totals.controls === 1 ? 'control' : 'controls'} · ${formatCount(ov.internal?.controls ?? 0)} internal` : undefined;

  const views: Array<{ key: CatalogView; label: string; count?: number }> = [
    { key: 'domain', label: 'By domain' },
    { key: 'framework', label: 'By framework' },
    { key: 'all', label: 'All controls' },
    { key: 'mine', label: 'My work', count: mine.data?.total },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={label}
        info="Your working controls, organised by the unified security domains: assign them, test them, attach evidence and certify."
        meta={meta}
        actions={(
          <>
            <Button href="/controls/configure-frameworks" leftIcon={<SlidersHorizontal aria-hidden />} title="Choose which frameworks are in your Control Catalog">
              {`Configure frameworks · ${nFrameworks > 0 ? formatCount(nFrameworks) : 'All'}`}
            </Button>
            {internal && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>New internal control</Button>}
          </>
        )}
      />
      <ControlSurfaceTabs active="catalog" />

      <SegmentedControl
        label="Which controls"
        name={`${uid}-mode`}
        options={[
          { value: 'framework', label: `Framework controls${ov ? ` ${formatCount(ov.totals.controls)}` : ''}` },
          { value: 'internal', label: `Internal controls${ov ? ` ${formatCount(ov.internal?.controls ?? 0)}` : ''}` },
        ]}
        value={page.mode}
        onChange={(v) => setAddress(modePatch(v as CatalogMode), { push: true })}
        className="self-start"
      />

      {!internal && nFrameworks > 0 && (
        <Notice
          tone="warning"
          icon={ShieldCheck}
          title={`This catalog is limited to ${formatCount(nFrameworks)} ${nFrameworks === 1 ? 'framework' : 'frameworks'}`}
          action={scope?.can_edit
            ? <Button loading={clearScope.isPending} onClick={askClearScope}>Show every framework</Button>
            : <span className="text-ds-label text-ds-fg-muted">Set by an administrator</span>}
        >
          An administrator chose it for the whole organisation, so you are not seeing every framework’s controls.
        </Notice>
      )}

      {internal ? (
        <InternalView ov={ov} onNew={() => setCreating(true)} onOpenRow={setOpen} />
      ) : (
        <Tabs tabs={views} value={page.view} onChange={(v) => setAddress(viewPatch(v as CatalogView))} ariaLabel="Catalog views" countFormat="exact">
          <TabPanel tabKey="domain" className="pt-[16px]">
            {page.openDomain ? (
              <DomainDetail domain={page.openDomain} ov={ov} onBack={() => setAddress(openDomainPatch(''))} onOpenRow={setOpen} />
            ) : (
              <DomainHub ov={ov} loading={ovQ.isPending} error={ovQ.error} onRetry={() => { void ovQ.refetch(); }} onOpen={(d) => setAddress(openDomainPatch(d), { push: true })} onAttention={(k) => setAddress(attentionPatch(k), { push: true })} />
            )}
          </TabPanel>
          <TabPanel tabKey="framework" lazy className="pt-[16px]">
            <FrameworkView ov={ov} loading={ovQ.isPending} error={ovQ.error} onRetry={() => { void ovQ.refetch(); }} onOpenRow={setOpen} />
          </TabPanel>
          <TabPanel tabKey="all" lazy className="pt-[16px]">
            <AllControls filters={page.filters} page={page.page} scope={scope} onFilters={(p) => setAddress(filterPatch(p))} onPage={(n) => setAddress({ page: n })} onOpenRow={setOpen} />
          </TabPanel>
          <TabPanel tabKey="mine" lazy className="pt-[16px]">
            <MyWorkView onOpenRow={setOpen} />
          </TabPanel>
        </Tabs>
      )}

      {open && <ControlDrawer row={open} onClose={() => setOpen(null)} />}
      <NewControlSheet open={creating} onClose={() => setCreating(false)} />
      <PromoteSheet open={page.promote} onClose={closePromote} />
      {confirmDialog}
    </div>
  );
}
