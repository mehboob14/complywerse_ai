'use client';

// For a supplier contact without a working link: a new one, by email.

import { Shield } from 'lucide-react';
import { RequestLinkForm, Shell } from './_shared';

export default function SupplierNewLinkPage() {
  return (
    <Shell>
      <div className="rounded-2xl border border-ds-border bg-ds-surface p-6 shadow-sm sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#b9ddd8] bg-[#e6f4f1] px-3 py-1 text-xs font-medium text-[#0b4f4a]">
          <Shield aria-hidden className="h-3.5 w-3.5" /> Supplier portal
        </span>
        <h1 className="mt-3 text-xl font-semibold text-ds-fg">Get a new link</h1>
        <p className="mt-1 text-sm text-ds-fg-muted">We email a new personal link to a supplier contact’s address.</p>
        <div className="mt-6"><RequestLinkForm /></div>
      </div>
    </Shell>
  );
}
