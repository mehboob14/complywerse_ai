'use client';

// A notice above a register: what the list is not (it is cut, a source is missing), in a title and one line under it. It is the kit's Notice
// (components/ui/ds/Notice.tsx) in the warning tone with the info icon and a polite `status` role, which is what the three pages that use it
// (exceptions, attestation, a committee's actions) have always shown: new code uses Notice directly.
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Notice } from '@/components/ui/ds/Notice';

export function ListNotice({ title, children }: { title: string; children?: ReactNode }) {
  return <Notice tone="warning" role="status" icon={Info} title={title}>{children}</Notice>;
}
