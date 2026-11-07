'use client';

// Surfaces the finding's linked native Help Desk ticket in the always-visible
// sticky rail — the reverse of "Create Help Desk ticket". Previously the link
// only lived buried under the remediation card on the Remediation tab, so a
// finding never visibly showed it had a ticket. Status comes straight off the
// VulnTicketLink (kept live by the native-resolve status-sync), so resolving the
// ticket in the console flips this chip with no extra call. Native-only (scoped
// server-side) so a ServiceNow link never shows under a "HD #" label.

import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/cyber-assurance/lib/api';

type Ticket = {
  is_native?: boolean;
  external_ticket_id: string | null;
  normalised_status: string | null;
  resolved_at: string | null;
};

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  new: { label: 'Open', bg: '#DBE8FA', fg: '#28578F' },
  resolved: { label: 'Resolved', bg: '#CFF2E7', fg: '#0C7B59' },
  reopened: { label: 'Reopened', bg: '#FBE4D5', fg: '#B4530F' },
};

const card: CSSProperties = { background: '#fff', border: '1px solid #E8ECEE', borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)' };

// Server timestamps are naive UTC; parse as UTC so the resolved date doesn't
// read a day early west of UTC (same fix as the reports date formatter).
function utcDate(iso: string | null): string | null {
  if (!iso) return null;
  const zoned = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(zoned ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export default function HelpDeskLinkCard({ vulnId }: { vulnId: number }) {
  const { data } = useQuery({
    queryKey: ['itsm-tickets', vulnId],
    // Must carry the /vuln-management module prefix like every other vuln API call
    // (the bare /vulnerabilities path 404s, so the card silently rendered nothing).
    queryFn: async () => (await apiClient.get(`/vuln-management/vulnerabilities/${vulnId}/itsm-tickets`)).data as { tickets: Ticket[] },
    staleTime: 30_000,
  });
  const tickets = (data?.tickets ?? []).filter((t) => t.is_native && t.external_ticket_id);
  if (tickets.length === 0) return null; // nothing linked yet; the create action stays on the Remediation tab

  return (
    <section style={card}>
      <div style={{ padding: '11px 14px', borderBottom: '1px solid #F0F3F5' }}>
        <h4 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Help Desk</h4>
      </div>
      <div style={{ padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tickets.map((t, i) => {
          const s = STATUS[t.normalised_status || 'new'] || STATUS.new;
          const when = t.normalised_status === 'resolved' ? utcDate(t.resolved_at) : null;
          return (
            <Link
              key={`${t.external_ticket_id}-${i}`}
              href={`/cyber-assurance/helpdesk/tickets/${t.external_ticket_id}`}
              title="Open the linked Help Desk ticket"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textDecoration: 'none', color: 'inherit' }}
            >
              <span style={{ fontFamily: 'ui-monospace,Consolas,monospace', fontWeight: 600, fontSize: 12.5, color: '#014A81' }}>
                HD #{t.external_ticket_id}
              </span>
              <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {s.label}{when ? ` · ${when}` : ''}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
