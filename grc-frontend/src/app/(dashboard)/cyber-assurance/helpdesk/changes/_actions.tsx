"use client";

/**
 * Change approval-workflow controls: the approval_state badge, and a per-row
 * action menu that drives the §5 transition POSTs. `schedule` needs a planned
 * window so it opens a small modal; every other transition is a direct POST.
 *   POST /helpdesk/changes/{id}/{action}
 *   schedule body: {planned_start, planned_end}
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { Modal, Field, Input, Btn, FormError, hdCall } from "../_admin";

// approval_state → the transitions allowed from it (mirrors change.py's map).
type Step = { action: string; label: string; schedule?: boolean; danger?: boolean };
export const NEXT_STEPS: Record<string, Step[]> = {
  draft: [{ action: "submit", label: "Submit for approval" }],
  pending_approval: [
    { action: "approve", label: "Approve" },
    { action: "reject", label: "Reject", danger: true },
  ],
  approved: [{ action: "schedule", label: "Schedule…", schedule: true }],
  scheduled: [{ action: "start", label: "Start implementation" }],
  in_progress: [{ action: "review", label: "Move to review" }],
  review: [{ action: "complete", label: "Complete & close" }],
};
const TERMINAL = new Set(["closed", "cancelled", "rejected"]);

const STATE_CHIP: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-600",
  scheduled: "bg-sky-50 text-sky-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  review: "bg-violet-50 text-violet-700",
  closed: "bg-slate-100 text-slate-600",
  cancelled: "bg-rose-50 text-rose-600",
};
const titleize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function ApprovalBadge({ state }: { state?: string | null }) {
  if (!state) return <span className="text-[#CBD5E1]">—</span>;
  const key = state.toLowerCase();
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CHIP[key] || "bg-slate-100 text-slate-600"}`}>{titleize(state)}</span>;
}

export function ChangeActions({ change, onChanged }: { change: any; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // e.g. "CAB required: …" after submit
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const id = encodeURIComponent(change.name);
  const state = String(change.approval_state || "draft").toLowerCase();
  const steps = NEXT_STEPS[state] || [];
  const canCancel = !TERMINAL.has(state);

  const run = async (action: string) => {
    setOpen(false); setBusy(true); setErr(null); setNotice(null);
    const r = await hdCall("post", `/helpdesk/changes/${id}/${action}`);
    setBusy(false);
    if (!r.ok) { setErr(r.error || `Could not ${action} this change.`); return; }
    // The backend escalates an exposure-sensitive Standard change to CAB on submit.
    const reason = r.data?.escalation_reason;
    if (reason) setNotice(reason);  // reason already reads "CAB required: …"
    onChanged();
  };

  if (steps.length === 0 && !canCancel) return <span className="text-[11.5px] text-[#94A3B8]">No actions</span>;

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <Btn variant="ghost" busy={busy} onClick={() => setOpen((o) => !o)}>
        Actions <ChevronDown size={13} className="ml-0.5" />
      </Btn>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[190px] rounded-[10px] border border-[#E2E5EC] bg-white py-1 shadow-xl">
          {steps.map((s) => (
            <button
              key={s.action}
              onClick={() => (s.schedule ? (setOpen(false), setScheduling(true)) : run(s.action))}
              className={`block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[#F6F7FB] ${s.danger ? "text-rose-600" : "text-[#334155]"}`}
            >
              {s.label}
            </button>
          ))}
          {canCancel && (
            <>
              {steps.length > 0 && <div className="my-1 border-t border-[#EEF1F5]" />}
              <button onClick={() => run("cancel")} className="block w-full px-3 py-1.5 text-left text-[12.5px] text-rose-600 hover:bg-rose-50">
                Cancel change
              </button>
            </>
          )}
        </div>
      )}
      {err && <p className="absolute right-0 mt-1 whitespace-nowrap text-[11px] text-rose-600">{err}</p>}
      {notice && (
        <div className="absolute right-0 z-10 mt-1 inline-flex max-w-xs items-start gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-left text-[11px] font-medium text-amber-800 shadow-sm">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}
      {scheduling && (
        <ScheduleModal
          change={change}
          onClose={() => setScheduling(false)}
          onDone={() => { setScheduling(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** ISO/naive datetime → the value a datetime-local input expects (yyyy-MM-ddThh:mm). */
function toLocalInput(v?: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ScheduleModal({ change, onClose, onDone }: { change: any; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState(toLocalInput(change.planned_start));
  const [end, setEnd] = useState(toLocalInput(change.planned_end));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!start || !end) { setErr("Both a planned start and end are required."); return; }
    if (new Date(end) <= new Date(start)) { setErr("The planned end must be after the start."); return; }
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/changes/${encodeURIComponent(change.name)}/schedule`, {
      planned_start: toIso(start),
      planned_end: toIso(end),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not schedule this change."); return; }
    onDone();
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={`Schedule change #${change.name}`}
      subtitle="Set the planned implementation window"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} busy={busy}>Schedule</Btn>
        </>
      }
    >
      <FormError msg={err} />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Planned start" required><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Planned end" required><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
