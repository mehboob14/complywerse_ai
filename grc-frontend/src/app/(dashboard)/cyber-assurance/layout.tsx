'use client';

/**
 * Cybersecurity Assurance route-group layout.
 *
 * The cloned Complyverse pages under this group expect Complyverse's own context providers
 * (Toast + React Query from Providers, Guide from GuideProvider). GRC's outer
 * (dashboard)/layout supplies the app shell — AuthGuard, Sidebar, Header — so
 * here we only re-mount the Complyverse-specific providers the cloned pages consume,
 * scoped to this subtree. The `platform-ui compact-density cw-dashboard`
 * wrapper keeps Complyverse's scoped component styling intact.
 */

import Providers from '@/cyber-assurance/components/Providers';
import { GuideProvider, GuidePanel } from '@/cyber-assurance/components/guide';

export default function CyberAssuranceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <GuideProvider>
        <div className="platform-ui compact-density cw-dashboard">
          {children}
        </div>
        {/* Guide mode slide-over — renders nothing until a marker is clicked. */}
        <GuidePanel />
      </GuideProvider>
    </Providers>
  );
}
