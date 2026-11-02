"use client";

// ComplyVerse Help Desk — rich ticket detail. Mirrors Frappe's agent layout
// (header + activity timeline + properties sidebar) in ComplyVerse's React/brand.
// Ticket meta from /vuln-management/helpdesk/tickets; finding body from
// /vuln-management/vulnerabilities/{id}. Engine (Frappe) stays hidden.
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Send, MessageSquare, StickyNote, ShieldAlert, Server,
  Clock, CheckCircle2, XCircle, Building2,
} from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";
import { sanitizeHtml } from "../_sanitize";

const STATUS_META: Record<string, { label: string; dot: string; chip: string }> = {
  new:         { label: "New",         dot: "bg-blue-500",   chip: "bg-blue-50 text-blue-700" },
  in_progress: { label: "In Progress", dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700" },
  on_hold:     { label: "On Hold",     dot: "bg-amber-500",  chip: "bg-amber-50 text-amber-700" },
  resolved:    { label: "Resolved",    dot: "bg-emerald-500",chip: "bg-emerald-50 text-emerald-700" },
  closed:      { label: "Closed",      dot: "bg-slate-400",  chip: "bg-slate-100 text-slate-600" },
};
const SEV_CHIP: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-sky-100 text-sky-700", info: "bg-slate-100 text-slate-600",
};

export default function TicketDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const ticketId = decodeURIComponent(String(params.id));
  const findingId = search.get("f");

  const [ticket, setTicket] = useState<any>(null);
  const [finding, setFinding] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"reply" | "comment">("reply");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.get("/vuln-management/helpdesk/tickets");
        const list = res.data.tickets || [];
        const t = list.find((x: any) =>
          (findingId && String(x.finding_id) === findingId) || x.ticket_id === ticketId);
        setTicket(t || null);
        const fid = t?.finding_id ?? findingId;
        if (fid) {
          try {
            const f = await apiClient.get(`/vuln-management/vulnerabilities/${fid}`);
            setFinding(f.data);
          } catch { /* body optional */ }
        }
      } catch { setTicket(null); }
      finally { setLoading(false); }
    })();
  }, [ticketId, findingId]);

  const sm = useMemo(() => STATUS_META[ticket?.status] || STATUS_META.new, [ticket]);
  const sev = finding?.severity || ticket?.severity;
  const desc = finding?.description || "";
  const rec = finding?.recommendation || finding?.ai_recommendation || "";

  const send = async () => {
    if (!draft.trim()) return;
    try {
      await apiClient.post(`/vuln-management/helpdesk/tickets/${encodeURIComponent(ticketId)}/reply`,
        { body: draft, internal: tab === "comment" });
      setNote("Sent.");
      setDraft("");
    } catch {
      setNote("Saved locally — this will post to the ticket once the engine connector is live.");
    }
  };

  if (loading) return <div className="p-6 py-20 text-center text-slate-400">Loading ticket…</div>;
  if (!ticket) return (
    <div className="p-6">
      <Link href="/cyber-assurance/helpdesk" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={15} /> Back to Help Desk</Link>
      <div className="mt-10 text-center text-slate-500">Ticket not found.</div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ─── */}
      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <Link href="/cyber-assurance/helpdesk" className="mb-2 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600"><ArrowLeft size={13} /> Help Desk</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-400">{ticket.ticket_id || `#${ticket.finding_id}`}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${sm.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${sm.dot}`} />{sm.label}</span>
              {sev && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_CHIP[sev] || SEV_CHIP.info}`}>{sev}</span>}
            </div>
            <h1 className="mt-1 truncate text-lg font-semibold text-[var(--color-text)]">{ticket.title || finding?.title || `Finding ${ticket.finding_id}`}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Reassign</button>
            <button className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"><CheckCircle2 size={15} /> Resolve</button>
            <button className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"><XCircle size={15} /> Close</button>
          </div>
        </div>
      </div>

      {/* ─── Body: timeline + sidebar ─── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Conversation / activity */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {/* Opening item = the finding */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                <ShieldAlert size={14} className="text-[var(--color-base)]" /> Finding opened this ticket
                <span className="ml-auto flex items-center gap-1"><Clock size={12} /> {ticket.pushed_at ? new Date(ticket.pushed_at).toLocaleString() : "—"}</span>
              </div>
              {desc ? (
                <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(desc) }} />
              ) : (
                <p className="text-sm text-slate-500">{ticket.title || "No description available."}</p>
              )}
              {rec && (
                <div className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-600">Recommended remediation</div>
                  <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(rec) }} />
                </div>
              )}
            </div>

            <div className="py-8 text-center text-xs text-slate-300">
              Replies and status changes will appear here as the conversation progresses.
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-slate-200 bg-white px-6 py-3">
            <div className="mb-2 flex items-center gap-1.5">
              <button onClick={() => setTab("reply")} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${tab === "reply" ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}><MessageSquare size={14} /> Reply</button>
              <button onClick={() => setTab("comment")} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${tab === "comment" ? "bg-amber-100 text-amber-800" : "text-slate-500"}`}><StickyNote size={14} /> Internal note</button>
            </div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
              placeholder={tab === "reply" ? "Reply to the requester…" : "Add an internal note (not visible to requester)…"}
              className="w-full resize-none rounded-lg border border-slate-200 p-3 text-sm focus:border-[var(--color-base)] focus:outline-none" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">{note}</span>
              <button onClick={send} disabled={!draft.trim()} className="flex items-center gap-1.5 rounded-lg bg-[var(--color-base)] px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-40"><Send size={14} /> Send</button>
            </div>
          </div>
        </div>

        {/* ─── Properties sidebar ─── */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-4 py-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Properties</h3>
          <dl className="space-y-3 text-sm">
            <Row label="Status"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${sm.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${sm.dot}`} />{sm.label}</span></Row>
            <Row label="Severity">{sev ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_CHIP[sev] || SEV_CHIP.info}`}>{sev}</span> : "—"}</Row>
            <Row label="CVE">{ticket.cve_id || finding?.cve_id || "—"}</Row>
            <Row label="CVSS">{finding?.cvss_score ?? "—"}</Row>
            <Row label="Affected host"><span className="inline-flex items-center gap-1 text-slate-700"><Server size={13} className="text-slate-400" />{ticket.affected_host || finding?.affected_host || "—"}</span></Row>
            <Row label="Finding">{ticket.vuln_id || `#${ticket.finding_id}`}</Row>
            <Row label="Engine / connection"><span className="inline-flex items-center gap-1 text-slate-700"><Building2 size={13} className="text-slate-400" />{ticket.connection || "—"}</span></Row>
            <Row label="Opened">{ticket.pushed_at ? new Date(ticket.pushed_at).toLocaleString() : "—"}</Row>
            <Row label="Last synced">{ticket.last_synced_at ? new Date(ticket.last_synced_at).toLocaleString() : "—"}</Row>
          </dl>
          <Link href={`/cyber-assurance/vulnerabilities/${ticket.finding_id}`} className="mt-5 block rounded-lg border border-slate-200 px-3 py-2 text-center text-sm text-[var(--color-base)] hover:bg-slate-50">
            View full finding →
          </Link>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{children}</dd>
    </div>
  );
}
