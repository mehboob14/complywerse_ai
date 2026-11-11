'use client';

// A word of the library with its plain meaning in an (i) beside it: `<PlainTerm term="owner">Owner</PlainTerm>` draws "Owner (i)"; without children it draws the (i) alone, to put after a
// column header, a facet title or a label the page already draws. The meanings are glossary.ts's (one place, tested); the (i) is the kit's InfoTip: hover or focus shows it, a tap opens it,
// Escape closes it, and its words are always in the page for a screen reader.
import type { ReactNode } from 'react';
import { InfoTip } from '@/components/ui';
import { plainOf, termLabel, type TermKey } from './glossary';

export function PlainTerm({ term, children, align }: { term: TermKey; children?: ReactNode; align?: 'start' | 'end' }) {
  const tip = <InfoTip text={plainOf(term)} label={termLabel(term)} align={align} />;
  if (children === undefined || children === null || children === false) return tip;
  return <span className="inline-flex min-w-0 items-center gap-[2px]"><span className="min-w-0">{children}</span>{tip}</span>;
}
