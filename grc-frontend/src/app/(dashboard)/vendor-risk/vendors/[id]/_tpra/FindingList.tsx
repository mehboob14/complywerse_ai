'use client';

// THE list of findings: the same cards, the one finding open at a time, a deep-linked finding opened and scrolled to once it has drawn. The vendor record's Findings tab and the lifecycle's
// Findings stage both draw it (with their own data and their own controls above it), as does `useSharedFindings`: which of the findings were shared with the vendor and are not finished.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { requestsApi, type SupplierRequest } from '../../../_lib/requestsApi';
import type { FindingRow } from '../../../_lib/findingsApi';
import FindingCard, { type Rights } from './FindingCard';

/** The findings shared with the vendor and not finished (one request each at a time), by finding id. */
export function useSharedFindings(vendorId: number | null | undefined): ReadonlyMap<number, SupplierRequest> {
  const { data } = useQuery({
    queryKey: ['tprm-supplier-requests', vendorId],
    queryFn: async () => (await requestsApi.list(vendorId as number)).data,
    enabled: !!vendorId,
  });
  return useMemo(() => new Map((data?.items || [])
    .filter((r) => r.finding && ['open', 'submitted', 'returned'].includes(r.status))
    .map((r) => [r.finding!.id, r] as const)), [data]);
}

export default function FindingList({ items, people, rights, shared, deepLinkId, onChanged, boxed = false }: {
  items: FindingRow[];
  people: Array<{ id: number; name: string }>;
  rights: Rights;
  shared: ReadonlyMap<number, SupplierRequest>;
  /** a finding named in the address (?finding=): opened and scrolled to once it is in the list */
  deepLinkId?: number | null;
  onChanged?: () => void;
  /** a frame around the list (the lifecycle stage); the record's tab sits in a card of its own */
  boxed?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(deepLinkId ?? null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || deepLinkId == null) return;
    if (items.some((f) => f.id === deepLinkId)) {
      setOpen(deepLinkId);
      done.current = true;
      // after the card has drawn, bring it into view
      setTimeout(() => document.getElementById(`tpra-finding-${deepLinkId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    }
  }, [items, deepLinkId]);
  return (
    <ul className={`m-0 list-none divide-y divide-ds-border p-0 ${boxed ? 'rounded-ds-card border border-ds-border bg-ds-surface px-[16px]' : ''}`}>
      {items.map((f) => (
        <FindingCard
          key={f.id} finding={f} people={people} rights={rights} shared={shared.get(f.id)}
          expanded={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} highlight={deepLinkId === f.id} onChanged={onChanged}
        />
      ))}
    </ul>
  );
}
