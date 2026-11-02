'use client';

// A thin bar and "83% · 10/12": how many of the people on the campaign's email domain have acknowledged it (the rule is the server's and coverageOf's in
// _logic.ts: unique acknowledgements over active users on the domain, nothing when nobody is on it). A screen reader and the tooltip get the words; a
// campaign nobody can acknowledge reads "—" and says why. Acknowledgements are counted here and nowhere else: they are never added to a count of approvals.
import { EMPTY } from '@/lib/format';
import { coverageOf, type CoverageSource } from './_logic';

export function Coverage({ c }: { c: CoverageSource }) {
  const view = coverageOf(c);
  if (!view) {
    return (
      <span className="text-ds-fg-muted" title="No active users on the email domain yet">
        <span aria-hidden>{EMPTY}</span>
        <span className="sr-only">Not measured: no active users on the email domain yet</span>
      </span>
    );
  }
  return (
    <span role="img" aria-label={view.words} title={view.words} className="inline-flex items-center gap-2">
      <span className="h-[6px] w-[80px] shrink-0 overflow-hidden rounded-full bg-ds-border">
        <span className="block h-full rounded-full" style={{ width: `${view.width}%`, background: view.colour }} />
      </span>
      <span className="whitespace-nowrap text-ds-label tabular-nums text-ds-fg-body">{view.text}</span>
    </span>
  );
}
