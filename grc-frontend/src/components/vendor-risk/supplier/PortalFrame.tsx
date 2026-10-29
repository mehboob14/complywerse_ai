// The page round everything a supplier sees: no navigation and no account, and the one thing worth saying at the foot of every page.

import type { ReactNode } from 'react';

export function PortalFrame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {children}
        <p className="mt-8 text-xs leading-5 text-gray-600">
          Only the team that sent this sees your answers. Anyone with this link can answer for you, so do not forward it.
        </p>
      </div>
    </main>
  );
}
