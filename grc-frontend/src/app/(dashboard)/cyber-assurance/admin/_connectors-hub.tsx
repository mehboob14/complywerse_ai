'use client';

// One consolidated Connectors page. Everything — external connectors, the Nessus
// vulnerability scanner (in the Pen-test group) and cloud posture (its own section)
// — now lives inside ConnectorsPage, so this is a thin wrapper with no tabs.
//
// The ConnectorCategory type + initialCategory prop are kept so admin/page.tsx's
// legacy ?tab=identity / ?tab=integrations deep-links still type-check; the value
// is no longer needed for routing now that it's a single page.
import ConnectorsPage from './connectors/page';

export type ConnectorCategory = 'external' | 'scanners' | 'cloud';

export default function ConnectorsHub(_props: { initialCategory?: ConnectorCategory }) {
  return <ConnectorsPage />;
}
