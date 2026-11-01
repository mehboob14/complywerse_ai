"use client";

/**
 * Requester portal — request detail + reply.
 *
 * GET /helpdesk/portal/requests/{id} → { ticket, conversation } (server returns
 * 404 unless raised_by == current_user). Shows the conversation as replies only
 * (internal notes/activity are hidden from the requester) and lets them reply via
 * POST /helpdesk/portal/requests/{id}/reply.
 */
import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, MessageSquareText, Paperclip, Download, Server, Users, ShieldCheck } from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";
import { Chip, ErrorBanner, Loading, SlaBadge, TimelineItem, useHd } from "../../../_ui";

const fmt = (v?: string | null) => (v && !isNaN(new Date(v).getTime()) ? new Date(v).toLocaleString() : "—");
const doneRe = /resolved|closed/i;

const FRIENDLY_STATUS: Record<string, string> = {
  open: "Received", new: "Received", replied: "Awaiting your reply",
  in_progress: "In progress", paused: "On hold", on_hold: "On hold",
  resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};
const friendly = (s?: string | null) => FRIENDLY_STATUS[(s || "").toLowerCase().replace(/\s+/g, "_")] || s || "—";

export default function MyRequestDetail() {
  const params = useParams();
  const id = decodeURIComponent(String(params.id));
  const base = `/helpdesk/portal/requests/${encodeURIComponent(id)}`;
  const { data, loading, error, reload } = useHd<any>(base);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Attachments use the shared, owner-gated ticket endpoints (the backend lets
  // a requester upload/list/download on their OWN ticket).
  const attachBase = `/helpdesk/tickets/${encodeURIComponent(id)}/attachments`;
  const { data: attachData, reload: reloadAttachments } = useHd<any>(attachBase);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const attachments: any[] = attachData?.attachments || [];

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true); setNote(null);
    try {
      await apiClient.post(attachBase, form, { headers: { "Content-Type": "multipart/form-data" } });
      setNote(`Attached ${file.name}.`); reloadAttachments();
    } catch (err: any) {
      const msg = err?.response?.data?.detail;
      setNote(typeof msg === "string" ? msg : "Sorry — we couldn't attach that file.");
    } finally { setUploading(false); }
  };

  const downloadAttachment = async (att: { id: number; filename?: string }) => {
    try {
      const res = await apiClient.get(`/helpdesk/attachments/${att.id}/download`, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url; a.download = att.filename || `attachment-${att.id}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch { setNote("Couldn't download that attachment."); }
  };

  const t = data?.ticket;
  const conv: any[] = data?.conversation || [];

  // Requesters only see replies (+ their own original message) — never internal notes/activity.
  const replies = useMemo(() => {
    const out: any[] = [];
    if (t?.description) out.push({ type: "received", sender: t.raised_by || t.contact || "You", content: t.description, date: t.created || t.creation });
    for (const m of conv) {
      if (/activity|comment|note/i.test(m.type || "")) continue;
      out.push(m);
    }
    return out;
  }, [conv, t]);

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true); setNote(null);
    try {
      await apiClient.post(`${base}/reply`, { content: draft, body: draft });
      setDraft(""); setNote("Your reply has been sent."); reload();
    } catch {
      setNote("Sorry — we couldn't send that reply. Please try again.");
    } finally { setBusy(false); }
  };

  if (loading) return <div className="p-6"><Loading what="your request" /></div>;
  if (!t) return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href="/cyber-assurance/helpdesk/portal/my-requests" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={15} /> My Requests</Link>
      {error ? <ErrorBanner msg={error} /> : <div className="mt-10 text-center text-slate-500">We couldn't find that request.</div>}
    </div>
  );

  const done = doneRe.test(t.status || "");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 text-[#0F172A]">
      <div>
        <Link href="/cyber-assurance/helpdesk/portal/my-requests" className="mb-2 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600"><ArrowLeft size={13} /> My Requests</Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-400">#{t.name || id}</span>
          <Chip value={friendly(t.status)} />
        </div>
        <h1 className="mt-1 text-xl font-semibold text-[#0F172A]">{t.subject || `Request ${id}`}</h1>
        {!done && t.response_by && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[#64748B]">
            We'll respond by <SlaBadge due={t.response_by} /> <span className="text-slate-300">·</span> raised {fmt(t.created || t.creation)}
          </p>
        )}
        {(t.ci?.name || t.team) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[#64748B]">
            {t.ci?.name && <span className="inline-flex items-center gap-1.5"><Server size={13} className="text-slate-400" /> {t.ci.name}</span>}
            {t.team && <span className="inline-flex items-center gap-1.5"><Users size={13} className="text-slate-400" /> {t.team}</span>}
          </div>
        )}
      </div>

      {data?.approval && <ApprovalBanner ap={data.approval} />}

      {note && <div className="rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-500">{note}</div>}

      <div className="space-y-4 rounded-2xl border border-[#EEF1F5] bg-white p-5">
        {replies.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-300">No messages yet.</div>
        ) : replies.map((m, i) => <TimelineItem key={i} m={m} />)}
        {attachments.length > 0 && (
          <div className="border-t border-[#EEF1F5] pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Attachments</div>
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <button key={a.id} onClick={() => downloadAttachment(a)} title={`Download ${a.filename}`}
                  className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                  <Paperclip size={12} className="shrink-0" />
                  <span className="truncate">{a.filename}</span>
                  {typeof a.size_bytes === "number" && <span className="shrink-0 text-slate-400">{Math.max(1, Math.round(a.size_bytes / 1024))} KB</span>}
                  <Download size={12} className="shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {done ? (
        <div className="flex flex-col gap-3">
          <FeedbackCard id={id} rating={t.feedback_rating ?? null} onDone={reload} />
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4 text-center text-sm text-slate-500">
            This request is {friendly(t.status).toLowerCase()}. Need more help?{" "}
            <Link href="/cyber-assurance/helpdesk/portal/report" className="font-medium text-[#005B96] hover:underline">Report a new issue</Link>.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#EEF1F5] bg-white p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#475569]">
            <MessageSquareText size={14} /> Add a reply
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Type your reply to our team…"
            className="w-full resize-y rounded-[9px] border border-[#E2E5EC] bg-white p-3 text-[13px] text-[#0F172A] outline-none placeholder:text-[#94A3B8] focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15"
          />
          <div className="mt-2 flex items-center justify-between">
            <input ref={fileInputRef} type="file" className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" onChange={onPickFile} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-1.5 rounded-[9px] border border-[#E2E5EC] px-2.5 py-1.5 text-xs text-[#64748B] hover:bg-slate-50 disabled:opacity-40">
              <Paperclip size={13} /> {uploading ? "Uploading…" : "Attach file"}
            </button>
            <button onClick={send} disabled={busy || !draft.trim()} className="flex items-center gap-1.5 rounded-[9px] bg-[#005B96] px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-[#014A81] disabled:opacity-40">
              <Send size={14} /> Send reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Requester-facing approval status for their own request (they can't vote — SoD). */
function ApprovalBanner({ ap }: { ap: any }) {
  const state = String(ap?.state || "pending").toLowerCase();
  const q = ap?.required_quorum || 1;
  const n = ap?.approve_count || 0;
  const MAP: Record<string, { cls: string; label: string }> = {
    pending: { cls: "border-amber-200 bg-amber-50 text-amber-800", label: `Waiting for approval — ${n} of ${q} approved` },
    approved: { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Approved — on its way to the team" },
    rejected: { cls: "border-rose-200 bg-rose-50 text-rose-700", label: "Not approved" },
  };
  const m = MAP[state] || MAP.pending;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${m.cls}`}>
      <ShieldCheck size={14} className="shrink-0" /> {m.label}
    </div>
  );
}

/** Post-resolution CSAT — lets the requester rate their own resolved request. */
function FeedbackCard({ id, rating, onDone }: { id: string; rating: number | null; onDone: () => void }) {
  const base = `/helpdesk/portal/requests/${encodeURIComponent(id)}`;
  const { data } = useHd<{ options: { rating: number; label: string }[] }>("/helpdesk/portal/feedback-options");
  const opts = data?.options || [];
  const [picked, setPicked] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (rating != null || sent) {
    const label = opts.find((o) => Math.abs(o.rating - (rating ?? 0)) < 0.01)?.label;
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-700">
        Thanks for your feedback{label ? ` — you rated this “${label}”` : ""}.
      </div>
    );
  }

  const submit = async () => {
    if (picked == null) return;
    setBusy(true);
    try {
      await apiClient.post(`${base}/feedback`, { rating: picked, comment: comment.trim() || undefined });
      setSent(true); onDone();
    } catch { /* keep the form up on error */ } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-[#EEF1F5] bg-white px-4 py-4">
      <div className="mb-2 text-sm font-medium text-[#0F172A]">How did we do?</div>
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <button key={o.rating} type="button" onClick={() => setPicked(o.rating)}
            className={`rounded-full border px-3 py-1 text-xs transition ${picked === o.rating ? "border-[#005B96] bg-[#005B96]/10 text-[#005B96]" : "border-slate-200 text-slate-600 hover:border-[#005B96]/50"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
        placeholder="Any comments? (optional)"
        className="mt-3 w-full resize-y rounded-[9px] border border-[#E2E5EC] p-2.5 text-[13px] outline-none focus:border-[#005B96]" />
      <div className="mt-2 flex justify-end">
        <button onClick={submit} disabled={busy || picked == null}
          className="rounded-[9px] bg-[#005B96] px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          Submit feedback
        </button>
      </div>
    </div>
  );
}
