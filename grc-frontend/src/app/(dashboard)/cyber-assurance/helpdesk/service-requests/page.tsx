"use client";

/**
 * Help Desk — Service Requests (process === 'service_request').
 * Tickets list columns + the service-catalog category/subcategory pair.
 * Read GET /helpdesk/service-requests.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardList, Inbox, Search } from "lucide-react";
import { Chip, PRIORITY_CHIP, ErrorBanner, Empty, Loading, PageHeader, SlaBadge, Table, timeAgo, useHd } from "../_ui";
import { Btn } from "../_admin";
import { NewTicketDialog } from "../_newticket";

export default function HelpDeskServiceRequests() {
  const { data, loading, error, reload } = useHd<{ tickets: any[] }>("/helpdesk/service-requests");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);

  const tickets = data?.tickets || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tickets;
    return tickets.filter(
      (t) =>
        String(t.subject || "").toLowerCase().includes(needle) ||
        String(t.name || "").includes(needle) ||
        String(t.request_category || "").toLowerCase().includes(needle),
    );
  }, [tickets, q]);

  return (
    <div className="flex flex-col gap-4 text-[#0F172A]">
      <PageHeader icon={ClipboardList} title="Service Requests" subtitle="Catalog requests — hardware, access, onboarding & more"
        actions={<Btn variant="primary" onClick={() => setShowNew(true)}>New request</Btn>} />

      {error && <ErrorBanner msg={error} />}

      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subject, #id or category…"
          className="w-full rounded-[9px] border border-[#E2E5EC] bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15"
        />
      </div>

      {loading ? (
        <Loading what="service requests" />
      ) : filtered.length === 0 ? (
        <Empty
          icon={Inbox}
          title={q ? "No service requests match your search" : "No service requests yet"}
          hint={q ? "Try a different term." : "Requests raised from the service catalog show up here."}
        />
      ) : (
        <Table head={["#", "Subject", "Status", "Priority", "Category", "Subcategory", "Team", "Assignee", "SLA", "Created"]}>
          {filtered.map((t) => (
            <tr key={t.name} className="hover:bg-[#F9FAFC]">
              <td className="px-4 py-2.5 font-mono text-[11px] text-[#94A3B8]">
                <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(t.name)}`} className="hover:text-[#005B96]">#{t.name}</Link>
              </td>
              <td className="px-4 py-2.5">
                <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(t.name)}`} className="font-medium text-[#0F172A] hover:text-[#005B96]">
                  {t.subject || "(no subject)"}
                </Link>
              </td>
              <td className="px-4 py-2.5"><Chip value={t.status} /></td>
              <td className="px-4 py-2.5"><Chip value={t.priority} map={PRIORITY_CHIP} /></td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.request_category || "—"}</td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.request_subcategory || "—"}</td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.team || "—"}</td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.agent || <span className="text-[#CBD5E1]">Unassigned</span>}</td>
              <td className="px-4 py-2.5"><SlaBadge due={t.response_by} done={/resolved|closed/i.test(t.status || "")} /></td>
              <td className="px-4 py-2.5 text-[11.5px] text-[#94A3B8]">{timeAgo(t.created)}</td>
            </tr>
          ))}
        </Table>
      )}
      {showNew && (
        <NewTicketDialog open lockProcess="service_request" onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload(); }} />
      )}
    </div>
  );
}
