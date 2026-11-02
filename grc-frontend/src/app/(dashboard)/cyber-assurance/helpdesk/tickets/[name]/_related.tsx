"use client";

/**
 * ITIL cross-process relationships (Batch 4 linkage A) on the ticket detail.
 * Reads the reverse-resolved `related` block the detail endpoint now attaches:
 *   - change   → its originating incident/problem (+ a picker to link/unlink it)
 *   - incident → the problem(s) it is part of + the change(s) raised from it
 *   - problem  → its linked incidents + the change(s) raised from it
 * Every counterpart is a link to /helpdesk/tickets/{name}. Self-contained; the
 * only writes are the change→origin link/unlink POSTs (processes:manage gated
 * on the server). Renders nothing when there is nothing related and no picker.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { GitBranch, Link2, Unlink } from "lucide-react";
import { useHd } from "../../_ui";
import { hdCall } from "../../_admin";

type TicketRef = { name: string; subject?: string | null; process?: string | null; status?: string | null };
export type RelatedBlock = { incidents: TicketRef[]; problems: TicketRef[]; changes: TicketRef[]; origin: TicketRef | null };

const PROCESS_CHIP: Record<string, string> = {
  incident: "bg-sky-50 text-sky-700",
  problem: "bg-violet-50 text-violet-700",
  change: "bg-amber-50 text-amber-700",
  service_request: "bg-emerald-50 text-emerald-700",
  question: "bg-slate-100 text-slate-600",
};
const titleize = (s?: string | null) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function RefLink({ r }: { r: TicketRef }) {
  const proc = (r.process || "").toLowerCase();
  return (
    <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(r.name)}`}
      className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] hover:bg-slate-50">
      <span className="font-mono text-[11px] text-[var(--color-base)]">#{r.name}</span>
      <span className="min-w-0 flex-1 truncate text-slate-700">{r.subject || "(no subject)"}</span>
      {proc && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PROCESS_CHIP[proc] || "bg-slate-100 text-slate-600"}`}>{titleize(proc)}</span>}
    </Link>
  );
}

function Section({ title, items }: { title: string; items: TicketRef[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-slate-400">{title}</div>
      <div className="space-y-1">{items.map((r) => <RefLink key={r.name} r={r} />)}</div>
    </div>
  );
}

/** A change's origin incident/problem: the link, plus a picker to set/clear it. */
function OriginSection({ name, origin, onChanged }: { name: string; origin: TicketRef | null; onChanged?: () => void }) {
  const incidents = useHd<{ tickets: any[] }>("/helpdesk/incidents");
  const problems = useHd<{ tickets: any[] }>("/helpdesk/problems");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = encodeURIComponent(name);

  // Candidate origins: incidents + problems, excluding this ticket itself.
  const options = useMemo(() => {
    const inc = (incidents.data?.tickets || []).map((t) => ({ ...t, process: "incident" }));
    const prob = (problems.data?.tickets || []).map((t) => ({ ...t, process: "problem" }));
    return [...inc, ...prob].filter((t) => String(t.name) !== String(name));
  }, [incidents.data, problems.data, name]);

  const link = async () => {
    const origin_ticket_id = Number(pick);
    if (!origin_ticket_id) return;
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/changes/${id}/link-origin`, { origin_ticket_id });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not link that origin."); return; }
    setPick(""); onChanged?.();
  };
  const unlink = async () => {
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/changes/${id}/unlink-origin`);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not unlink the origin."); return; }
    onChanged?.();
  };

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-slate-400">Raised from</div>
      {origin ? (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1"><RefLink r={origin} /></div>
          <button onClick={unlink} disabled={busy} title="Unlink origin"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50">
            <Unlink size={13} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select value={pick} onChange={(e) => setPick(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-[12px] focus:outline-none">
            <option value="">Link an incident / problem…</option>
            {options.map((t) => (
              <option key={`${t.process}-${t.name}`} value={t.name}>
                #{t.name} · {titleize(t.process)} · {t.subject || "(no subject)"}
              </option>
            ))}
          </select>
          <button onClick={link} disabled={busy || !pick}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11.5px] font-medium text-[var(--color-base)] hover:bg-slate-50 disabled:opacity-50">
            <Link2 size={13} /> Link
          </button>
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}

export function RelatedTickets({ name, process, related, onChanged }: {
  name: string;
  process?: string | null;
  related?: RelatedBlock | null;
  onChanged?: () => void;
}) {
  const rel: RelatedBlock = related || { incidents: [], problems: [], changes: [], origin: null };
  const isChange = (process || "").toLowerCase() === "change";
  const hasAny = isChange || rel.origin || rel.incidents.length || rel.problems.length || rel.changes.length;
  if (!hasAny) return null;
  return (
    <div className="space-y-2">
      <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <GitBranch size={13} /> Related
      </h3>
      {isChange && <OriginSection name={name} origin={rel.origin} onChanged={onChanged} />}
      <Section title="Part of problem" items={rel.problems} />
      <Section title="Linked incidents" items={rel.incidents} />
      <Section title="Changes raised" items={rel.changes} />
    </div>
  );
}
