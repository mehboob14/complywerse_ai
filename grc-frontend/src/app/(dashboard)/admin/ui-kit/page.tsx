'use client';

// The living style guide: every design token and every shared component of the UI kit, live, in every variant and state, with when to use it,
// what not to do and its props. Administrators only and not in the sidebar. It is the surface the accessibility probe walks
// (.agent-context/tools/ux_kit_probe.mjs): a regression in the kit shows up here, in one place.
//
// Who can open it: nothing in the shell blocks a typed address (the layout only checks that a token exists; navAccess hides links), so the
// page guards itself like /users and /complychat do: PermissionGuard with navPermissions('/admin/ui-kit'), which for a page nobody listed is
// "nothing but an administrator" (empty list). Anyone else gets the NoAccessState below. Static fixtures only: no API calls, no secrets.
import { useEffect, useState } from 'react';
import { Button, NoAccessState, PageHeader, PermissionGuard, StatusPill } from '@/components/ui';
import { navPermissions } from '@/components/layout/navAccess';
import { TokensSection } from './_components/TokensSection';
import { ButtonsSection, FormsSection } from './_components/ControlsSection';
import { PeopleSection, StatusSection } from './_components/DisplaySection';
import { StatesSection } from './_components/StatesSection';
import { StatesMatrix } from './_components/StatesMatrix';
import { StructureSection } from './_components/StructureSection';
import { SettingsSection } from './_components/SettingsSection';
import { TablesSection } from './_components/TablesSection';
import { FiguresSection } from './_components/FiguresSection';
import { OverlaysSection } from './_components/OverlaysSection';
import { FormatSection } from './_components/FormatSection';
import { MONO } from './_components/Guide';

const PATH = '/admin/ui-kit';

const SECTIONS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'forms', label: 'Form controls' },
  { id: 'status', label: 'Status' },
  { id: 'people', label: 'People' },
  { id: 'states', label: 'States' },
  { id: 'structure', label: 'Structure' },
  { id: 'settings', label: 'Settings pages' },
  { id: 'tables', label: 'Tables' },
  { id: 'figures', label: 'Figures and charts' },
  { id: 'overlays', label: 'Overlays and feedback' },
  { id: 'formatting', label: 'Formatting' },
  { id: 'matrix', label: 'States matrix' },
];

function Guide() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));           // after the tokens have been read: the probe waits for this
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div data-guide-ready={ready ? 'true' : 'false'} className="mx-auto w-full max-w-[1200px] space-y-[24px] pb-[48px]">
      <PageHeader
        variant="page"
        title="UI kit"
        back={{ href: '/admin', label: 'Back to administration' }}
        info="Every design token and shared component, live, in every variant and state. Administrators only and not in the sidebar. The accessibility probe walks this page, so a regression in the kit shows up here."
        meta="Tokens, components and the states a page must handle"
        chips={<StatusPill tone="neutral" label="Administrators only" />}
      />
      <nav aria-label="Sections of the guide" className="flex flex-wrap gap-[4px]">
        {SECTIONS.map((s) => <Button key={s.id} href={`#${s.id}`} variant="link" size="sm">{s.label}</Button>)}
      </nav>
      <TokensSection />
      <ButtonsSection />
      <FormsSection />
      <StatusSection />
      <PeopleSection />
      <StatesSection />
      <StructureSection />
      <SettingsSection />
      <TablesSection />
      <FiguresSection />
      <OverlaysSection />
      <FormatSection />
      <StatesMatrix />
      <p className="border-t border-ds-border pt-[16px] text-ds-label text-ds-fg-muted">
        Adding a component: export it from <code className={MONO}>ds/index.ts</code>, document it in <code className={MONO}>_components/docs.ts</code> and draw its card (a <code className={MONO}>Spec</code>) in a section. <code className={MONO}>docs.test.ts</code> and <code className={MONO}>guide.test.ts</code> fail until all three are done. The accessibility probe is <code className={MONO}>.agent-context/tools/ux_kit_probe.mjs</code>.
      </p>
    </div>
  );
}

function Blocked() {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-[16px]">
      <PageHeader variant="page" title="UI kit" />
      <NoAccessState reason="This page is for administrators." action={<Button href="/dashboard">Back to dashboard</Button>} />
    </div>
  );
}

export default function UiKitPage() {
  return (
    <PermissionGuard required={navPermissions(PATH)} fallback={<Blocked />}>
      <Guide />
    </PermissionGuard>
  );
}
