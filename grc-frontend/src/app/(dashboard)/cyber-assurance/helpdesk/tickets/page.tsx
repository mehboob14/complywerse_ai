"use client";

/**
 * Help Desk — Tickets list + New-Ticket flow.
 *
 * The list reads GET /helpdesk/tickets. "New ticket" opens a dialog that submits
 * POST /helpdesk/tickets (subject, description, department_id, agent_group_id,
 * customer_id, contact). Department is the headline field: a chosen department
 * routes the ticket to its default team, then the existing assignment+SLA engine
 * runs. Priority / Ticket Type / Assignee are applied in a follow-up
 * /update + /assign call because the create endpoint keys them by id while the
 * only id-free catalogue the API exposes is /meta's label list (resolved by
 * label on the update path).
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Ticket, Inbox, Search } from "lucide-react";
import { Chip, PRIORITY_CHIP, ErrorBanner, Empty, Loading, PageHeader, Table, timeAgo, useHd } from "../_ui";
import { NewBtn } from "../_admin";
import { NewTicketDialog } from "../_newticket";

const PROCESS_LABEL: Record<string, string> = {
  incident: "Incident", change: "Change", service_request: "Service Request", problem: "Problem",
};

/** "Where did this ticket come from" cell: a finding deep-links to the vuln; other
 *  origins (a parent ticket, a department, the portal) render as plain text. */
function SourceCell({ t }: { t: any }) {
  if (t.source_kind === "vulnerability" && t.source_finding_id) {
    return (
      <Link href={`/cyber-assurance/vulnerabilities/${encodeURIComponent(String(t.source_finding_id))}`}
        className="font-medium text-[#005B96] hover:underline">
        {t.source || "Vulnerability finding"}
      </Link>
    );
  }
  return <span className="text-[#475569]">{t.source || <span className="text-[#CBD5E1]">—</span>}</span>;
}

export default function HelpDeskTickets() {
  const { data, loading, error, reload } = useHd<{ tickets: any[] }>("/helpdesk/tickets");
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
        String(t.contact || "").toLowerCase().includes(needle),
    );
  }, [tickets, q]);

  return (
    <div className="flex flex-col gap-4 text-[#0F172A]">
      <PageHeader
        icon={Ticket}
        title="Tickets"
        subtitle="Every request across all departments"
        actions={<NewBtn label="New ticket" onClick={() => setShowNew(true)} />}
      />

      {error && <ErrorBanner msg={error} />}

      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subject, #id or contact…"
          className="w-full rounded-[9px] border border-[#E2E5EC] bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15"
        />
      </div>

      {loading ? (
        <Loading what="tickets" />
      ) : filtered.length === 0 ? (
        <Empty
          icon={Inbox}
          title={q ? "No tickets match your search" : "No tickets yet"}
          hint={q ? "Try a different term." : "Create your first ticket with the New ticket button."}
        />
      ) : (
        <Table head={["#", "Subject", "Type", "Source", "Department", "Status", "Priority", "Team", "Assignee", "Created"]}>
          {filtered.map((t) => (
            <tr key={t.name} className="hover:bg-[#F9FAFC]">
              <td className="px-4 py-2.5 font-mono text-[11px] text-[#94A3B8]">
                <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(t.name)}`} className="hover:text-[#005B96]">
                  #{t.name}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(t.name)}`} className="font-medium text-[#0F172A] hover:text-[#005B96]">
                  {t.subject || "(no subject)"}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{PROCESS_LABEL[t.process] || "Incident"}</td>
              <td className="px-4 py-2.5 text-[12.5px]"><SourceCell t={t} /></td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.department || <span className="text-[#CBD5E1]">—</span>}</td>
              <td className="px-4 py-2.5"><Chip value={t.status} /></td>
              <td className="px-4 py-2.5"><Chip value={t.priority} map={PRIORITY_CHIP} /></td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.team || "—"}</td>
              <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.agent || <span className="text-[#CBD5E1]">Unassigned</span>}</td>
              <td className="px-4 py-2.5 text-[11.5px] text-[#94A3B8]">{timeAgo(t.created)}</td>
            </tr>
          ))}
        </Table>
      )}

      <NewTicketDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => {
          setShowNew(false);
          reload();
        }}
      />
    </div>
  );
}
