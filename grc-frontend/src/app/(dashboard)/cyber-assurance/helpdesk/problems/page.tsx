"use client";

/**
 * Help Desk — Problems (process === 'problem').
 * Tickets list columns + known-error badge, linked-incident count and whether a
 * root cause is recorded. A per-row "Manage" opens the process panel; the row
 * subject links to the shared ticket detail. Read GET /helpdesk/problems.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bug, Inbox, Search } from "lucide-react";
import { Chip, PRIORITY_CHIP, ErrorBanner, Empty, Loading, PageHeader, SlaBadge, Table, timeAgo, useHd } from "../_ui";
import { Btn } from "../_admin";
import { ProblemPanel, linkedIds } from "./_panel";
import { NewTicketDialog } from "../_newticket";

export default function HelpDeskProblems() {
  const { data, loading, error, reload } = useHd<{ tickets: any[] }>("/helpdesk/problems");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<any | null>(null);
  const [showNew, setShowNew] = useState(false);

  const tickets = data?.tickets || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tickets;
    return tickets.filter(
      (t) => String(t.subject || "").toLowerCase().includes(needle) || String(t.name || "").includes(needle),
    );
  }, [tickets, q]);

  return (
    <div className="flex flex-col gap-4 text-[#0F172A]">
      <PageHeader icon={Bug} title="Problems" subtitle="Root-cause investigations behind recurring incidents"
        actions={<Btn variant="primary" onClick={() => setShowNew(true)}>New problem</Btn>} />

      {error && <ErrorBanner msg={error} />}

      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subject or #id…"
          className="w-full rounded-[9px] border border-[#E2E5EC] bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15"
        />
      </div>

      {loading ? (
        <Loading what="problems" />
      ) : filtered.length === 0 ? (
        <Empty
          icon={Inbox}
          title={q ? "No problems match your search" : "No problems yet"}
          hint={q ? "Try a different term." : "Raise a problem to investigate recurring incidents."}
        />
      ) : (
        <Table head={["#", "Subject", "Status", "Priority", "Known error", "Incidents", "Root cause", "SLA", "Created", ""]}>
          {filtered.map((t) => {
            const ids = linkedIds(t.linked_incident_ids);
            return (
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
                <td className="px-4 py-2.5">
                  {t.known_error
                    ? <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Known error</span>
                    : <span className="text-[#CBD5E1]">—</span>}
                </td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{ids.length || <span className="text-[#CBD5E1]">0</span>}</td>
                <td className="px-4 py-2.5">
                  {t.root_cause
                    ? <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Recorded</span>
                    : <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Pending</span>}
                </td>
                <td className="px-4 py-2.5"><SlaBadge due={t.response_by} done={/resolved|closed/i.test(t.status || "")} /></td>
                <td className="px-4 py-2.5 text-[11.5px] text-[#94A3B8]">{timeAgo(t.created)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Btn variant="ghost" onClick={() => setActive(t)}>Manage</Btn>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {active && (
        <ProblemPanel
          problem={active}
          onClose={() => setActive(null)}
          onChanged={() => { setActive(null); reload(); }}
        />
      )}
      {showNew && (
        <NewTicketDialog
          open
          lockProcess="problem"
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); reload(); }}
        />
      )}
    </div>
  );
}
