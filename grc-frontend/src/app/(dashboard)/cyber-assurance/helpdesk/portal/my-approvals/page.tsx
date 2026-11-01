"use client";

/**
 * Requester portal — "My Approvals".
 *
 * Items waiting on THIS user's sign-off (service-request approvals and CAB
 * votes). Approve / Reject with an optional comment.
 *
 * Backend (live in portal.py; scoped server-side to the signed-in approver,
 * never trusting a client-supplied identity):
 *   GET  /helpdesk/portal/my-approvals
 *        -> { approvals: [{ id, kind: "request"|"cab"|"ecab", ticket_name, subject,
 *                           requested_by?, opened_at?, required_quorum?, approve_count?,
 *                           description?, process?, ci?, risk?, cost? }] }
 *        Context (description/ci/risk/cost) is included so the approver can decide
 *        WITHOUT opening the requester-owned ticket (which is own-ticket gated).
 *   POST /helpdesk/portal/approvals/{id}/vote   body { decision: "approve"|"reject", comment? }
 *        -> updated approval (wraps approvals.cast_vote with approver = current user)
 */
import { useState } from "react";
import { ShieldCheck, ThumbsUp, ThumbsDown, Clock, User, CheckCircle2, X, Server } from "lucide-react";
import { Avatar, Chip, ErrorBanner, Loading, PageHeader, RefreshBtn, timeAgo, useHd } from "../../_ui";
import { Btn, Modal, Field, Textarea, FormError, hdCall } from "../../_admin";

const KIND_LABEL: Record<string, string> = {
  request: "Service request",
  cab: "Change (CAB)",
  ecab: "Emergency change (ECAB)",
};
// Left accent + chip colour per approval kind, so emergency changes stand out.
const KIND_ACCENT: Record<string, string> = {
  request: "border-l-blue-400",
  cab: "border-l-indigo-400",
  ecab: "border-l-red-500",
};
const KIND_CHIP: Record<string, string> = {
  service_request: "bg-blue-50 text-blue-700",
  "change_(cab)": "bg-indigo-50 text-indigo-700",
  "emergency_change_(ecab)": "bg-red-100 text-red-700",
};
// Keys match the Chip lookup for "<level> risk" (lower-cased, spaces to underscores).
const RISK_CHIP: Record<string, string> = {
  low_risk: "bg-sky-50 text-sky-700", medium_risk: "bg-amber-50 text-amber-700",
  high_risk: "bg-orange-50 text-orange-700", critical_risk: "bg-red-50 text-red-700",
};

type Pending = { approval: any; decision: "approve" | "reject" };

export default function MyApprovals() {
  const { data, loading, error, reload } = useHd<{ approvals: any[] }>("/helpdesk/portal/my-approvals");
  const rows: any[] = Array.isArray(data?.approvals) ? data!.approvals : [];

  const [pending, setPending] = useState<Pending | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = (approval: any, decision: "approve" | "reject") => {
    setPending({ approval, decision }); setComment(""); setErr(null); setNotice(null);
  };
  const close = () => { if (!busy) setPending(null); };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/portal/approvals/${encodeURIComponent(String(pending.approval.id))}/vote`, {
      decision: pending.decision,
      comment: comment.trim() || null,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Sorry — we couldn't record that. Please try again."); return; }
    setNotice(
      `${pending.decision === "approve" ? "Approved" : "Rejected"} “${pending.approval.subject || `#${pending.approval.ticket_name}`}”.`,
    );
    setPending(null);
    reload();
  };

  const isApprove = pending?.decision === "approve";

  const pa = pending?.approval;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 text-[#0F172A]">
      <PageHeader
        icon={ShieldCheck}
        title="My Approvals"
        subtitle={
          loading
            ? "Requests and changes waiting for your decision."
            : rows.length > 0
              ? `${rows.length} item${rows.length === 1 ? "" : "s"} waiting for your decision.`
              : "Requests and changes waiting for your decision."
        }
        actions={<RefreshBtn onClick={reload} loading={loading} />}
      />

      {error && <ErrorBanner msg={error} />}
      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] text-emerald-700">
          <CheckCircle2 size={16} className="shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss message"
            className="grid h-6 w-6 place-items-center rounded-md text-emerald-600 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <Loading what="your approvals" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={30} />
          </div>
          <p className="text-base font-semibold text-slate-700">You're all caught up</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
            Nothing is waiting on you right now. When someone needs your approval, it will show up here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => {
            const kind = (a.kind || "").toLowerCase();
            const kindLabel = KIND_LABEL[kind] || a.kind || "Approval";
            const quorum = typeof a.required_quorum === "number" && a.required_quorum > 1 ? a.required_quorum : 0;
            const got = Math.min(Number(a.approve_count) || 0, quorum);
            return (
              <li
                key={a.id}
                className={`rounded-xl border border-l-4 border-slate-200 bg-white p-4 transition hover:shadow-sm ${KIND_ACCENT[kind] || "border-l-slate-300"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-[#94A3B8]">#{a.ticket_name}</span>
                      <Chip value={kindLabel} map={KIND_CHIP} />
                      {a.risk && <Chip value={`${a.risk} risk`} map={RISK_CHIP} />}
                      {a.cost != null && a.cost !== "" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Cost: {String(a.cost)}</span>
                      )}
                    </div>
                    {/* Not a link: the request detail is owner-gated and an approver
                        is never the raiser (SoD), so the context is shown inline instead. */}
                    <div className="mt-1.5 text-[15px] font-semibold text-[#0F172A]">
                      {a.subject || "(no subject)"}
                    </div>
                    {a.description && (
                      <p className="mt-1 line-clamp-3 text-[13px] text-slate-500">{a.description}</p>
                    )}
                    {a.ci?.name && (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-[#64748B]">
                        <Server size={12} className="text-slate-400" /> {a.ci.name}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[#64748B]">
                      {a.requested_by && (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar name={a.requested_by} size={20} />
                          <span className="inline-flex items-center gap-1"><User size={12} className="text-[#94A3B8]" /> Requested by {a.requested_by}</span>
                        </span>
                      )}
                      {a.opened_at && (
                        <span className="inline-flex items-center gap-1"><Clock size={12} className="text-[#94A3B8]" /> {timeAgo(a.opened_at)}</span>
                      )}
                    </div>
                    {quorum > 0 && (
                      <div className="mt-3 max-w-xs">
                        <div className="mb-1 flex justify-between text-[11px] text-[#64748B]">
                          <span>Approvals so far</span>
                          <span className="font-medium">{got} of {quorum}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(got / quorum) * 100}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                    <Btn
                      variant="danger"
                      className="!h-9 flex-1 sm:flex-none"
                      icon={<ThumbsDown size={14} />}
                      onClick={() => open(a, "reject")}
                      aria-label={`Reject ${a.subject || `request #${a.ticket_name}`}`}
                    >
                      Reject
                    </Btn>
                    <Btn
                      variant="primary"
                      className="!h-9 flex-1 sm:flex-none"
                      icon={<ThumbsUp size={14} />}
                      onClick={() => open(a, "approve")}
                      aria-label={`Approve ${a.subject || `request #${a.ticket_name}`}`}
                    >
                      Approve
                    </Btn>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={!!pending}
        onClose={close}
        title={isApprove ? "Approve this request?" : "Reject this request?"}
        subtitle={pa ? pa.subject || `#${pa.ticket_name}` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={close} disabled={busy}>Cancel</Btn>
            <Btn variant={isApprove ? "primary" : "danger"} onClick={confirm} busy={busy}>
              {isApprove ? "Yes, approve" : "Yes, reject"}
            </Btn>
          </>
        }
      >
        <FormError msg={err} />
        <div className="flex flex-col gap-4">
          {pa && (
            <div
              className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[12.5px] ${
                isApprove ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {isApprove ? <ThumbsUp size={16} className="mt-0.5 shrink-0" /> : <ThumbsDown size={16} className="mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <div className="font-semibold">
                  {isApprove ? "You're approving" : "You're rejecting"} {KIND_LABEL[(pa.kind || "").toLowerCase()]?.toLowerCase() || "this item"}
                  {pa.requested_by ? ` from ${pa.requested_by}` : ""}.
                </div>
                <div className="mt-0.5 opacity-80">
                  {isApprove
                    ? "It moves on to the next step once it has enough approvals."
                    : "Adding a short reason helps the requester know what to change."}
                </div>
              </div>
            </div>
          )}
          <Field
            label="Comment"
            hint={isApprove ? "Optional — add a note for the requester." : "Optional, but a short reason helps the requester understand."}
          >
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={isApprove ? "e.g. Approved — go ahead." : "e.g. Please add a cost centre and resubmit."}
              autoFocus
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
