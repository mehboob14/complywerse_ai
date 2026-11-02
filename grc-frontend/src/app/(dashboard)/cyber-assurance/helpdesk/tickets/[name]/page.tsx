"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, MessageSquare, StickyNote, CheckCircle2, XCircle, UserPlus, ShieldAlert, ShieldCheck, Activity, Mail, Paperclip, Download, ExternalLink, ChevronDown } from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";
import { Chip, PRIORITY_CHIP, ErrorBanner, Loading, PropRow, SlaBadge, TimelineItem, useHd, utcDate } from "../../_ui";
import { AffectedCiPicker, inventoryUrl } from "../../_ci";
import { RichComposer, isEmptyHtml } from "../../RichText";
import { RelatedTickets } from "./_related";
import { ImpactedCis } from "./_impacted";
import { Knowledge } from "./_knowledge";
import { ChangeActions, ApprovalBadge } from "../../changes/_actions";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ComboBoxInput } from "@/cyber-assurance/components/ui/ComboBoxInput";

// Backend created/creation are NAIVE UTC (datetime.utcnow(), no zone). new Date()
// would read them as LOCAL → the date lands a day early west of UTC (QA: a ticket
// created 21 Oct showed 20/10). utcDate normalises naive strings to UTC first.
const fmt = (v?: string | null) => { const d = utcDate(v); return isNaN(d.getTime()) ? "—" : d.toLocaleString(); };
const doneRe = /replied|resolved|closed/i;
type ConvTab = "replies" | "comments" | "activity";

// Markdown renderer for the ticket description. The default `prose` scale blew
// the finding's `#` heading up to a page-title H1 and dropped list markers
// (Tailwind preflight strips them); this maps every node to the app's own body
// scale (~13px) with real numbered steps and monospace shell commands.
const md: Components = {
  h1: ({ children }) => <div className="mb-1.5 mt-1 text-[12.5px] font-semibold text-slate-800">{children}</div>,
  h2: ({ children }) => <div className="mb-1 mt-2.5 text-[12px] font-semibold text-slate-700">{children}</div>,
  h3: ({ children }) => <div className="mb-1 mt-2 text-[12px] font-semibold text-slate-700">{children}</div>,
  p: ({ children }) => <p className="my-1.5 text-[13px] leading-relaxed text-slate-600">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 text-[13px] text-slate-600 marker:text-slate-400">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 text-[13px] text-slate-600 marker:font-medium marker:text-[var(--color-base)]">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-800">{children}</code>,
  pre: ({ children }) => <pre className="my-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[12px] leading-relaxed text-slate-800">{children}</pre>,
  a: ({ href, children }) => <a href={href} className="font-medium text-[var(--color-base)] underline hover:no-underline">{children}</a>,
  strong: ({ children }) => <strong className="font-semibold text-slate-800">{children}</strong>,
  hr: () => <hr className="my-2.5 border-slate-100" />,
};

// Stacked label-over-control field for the editable Properties rail.
function PropField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><div className="mb-1 truncate text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>{children}</div>;
}

export default function TicketDetail() {
  const params = useParams();
  const name = decodeURIComponent(String(params.name));
  const base = `/helpdesk/tickets/${encodeURIComponent(name)}`;
  const { data, loading, error, reload } = useHd<any>(base);
  const { data: meta } = useHd<any>("/helpdesk/meta");
  const { data: agentsData } = useHd<any>("/helpdesk/agents");
  const { data: teamsData } = useHd<any>("/helpdesk/teams");
  const { data: deptData } = useHd<any>("/helpdesk/departments");
  const { data: custData } = useHd<any>("/helpdesk/customers");
  const [tab, setTab] = useState<"reply" | "comment">("reply");
  const [convTab, setConvTab] = useState<ConvTab>("replies");
  const [draft, setDraft] = useState("");
  const [composerKey, setComposerKey] = useState(0); // remount to re-seed RichComposer
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [savedReply, setSavedReply] = useState("");
  const [composerOpen, setComposerOpen] = useState(false); // on-demand reply/note composer
  const [showMore, setShowMore] = useState(false); // Customer/Contact popover in the toolbar

  const { data: canned } = useHd<any>("/helpdesk/canned-responses");
  const { data: attachData, reload: reloadAttachments } = useHd<any>(`${base}/attachments`);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const attachments: any[] = attachData?.attachments || [];

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      await apiClient.post(`${base}/attachments`, form, { headers: { "Content-Type": "multipart/form-data" } });
      setNote(`Attached ${file.name}.`);
      reloadAttachments();
    } catch (err: any) {
      const msg = err?.response?.data?.detail;
      setNote(typeof msg === "string" ? msg : "Couldn't attach that file.");
    } finally {
      setUploading(false);
    }
  };

  const downloadAttachment = async (att: { id: number; filename?: string }) => {
    try {
      const res = await apiClient.get(`/helpdesk/attachments/${att.id}/download`, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename || `attachment-${att.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setNote("Couldn't download that attachment.");
    }
  };

  const t = data?.ticket;
  const conv: any[] = data?.conversation || [];
  const sla = t?.sla || {};

  // ── group the conversation into the three tabs (default Replies) ──
  const { replies, comments, activity } = useMemo(() => {
    // The opening description is rendered as its own markdown "Description" card
    // (below), NOT folded into the reply thread as a raw-HTML "Customer" bubble —
    // vuln-pushed descriptions are markdown and were showing literal **/# + a
    // collapsed wall of text.
    const replies: any[] = [], comments: any[] = [], activity: any[] = [];
    for (const m of conv) {
      if (/activity/i.test(m.type || "")) activity.push(m);
      else if (/comment|note/i.test(m.type || "")) comments.push(m);
      else replies.push(m);
    }
    return { replies, comments, activity };
  }, [conv, t]);
  const shown = convTab === "comments" ? comments : convTab === "activity" ? activity : replies;

  const resetDraft = () => { setDraft(""); setCc(""); setBcc(""); setShowCc(false); setComposerKey((k) => k + 1); };
  const act = async (path: string, body: any, ok: string) => {
    try {
      const res = await apiClient.post(`${base}/${path}`, body);
      // The ticket action endpoints return HTTP 200 with {ok:false, error} on a
      // LOGICAL rejection (e.g. an illegal status transition) — they don't throw.
      // Surface the backend reason and don't claim success / don't reload.
      if (res?.data?.ok === false) { setNote(res.data.error || "That action couldn't be completed."); return false; }
      setNote(ok); reload(); return true;
    } catch { setNote("Action isn't available yet — the engine connector may be read-only."); return false; }
  };
  const send = async () => {
    const isComment = tab === "comment";
    if (isComment ? !draft.trim() : isEmptyHtml(draft)) return;
    const body: any = { content: draft, body: draft, internal: isComment };
    if (!isComment) { if (cc.trim()) body.cc = cc.trim(); if (bcc.trim()) body.bcc = bcc.trim(); }
    const ok = await act("reply", body, isComment ? "Note added." : "Reply logged.");
    if (ok) resetDraft();
  };
  const assign = async (agent?: string | null, team?: string | null) => {
    // Send ONLY the field being changed (undefined = omit) so setting the team
    // doesn't wipe the assignee and vice versa (bug 1). null = explicit clear.
    const body: any = {};
    if (agent !== undefined) body.agent = agent;
    if (team !== undefined) body.team = team;
    const ok = await act("assign", body, "Assignment updated.");
    if (ok) setShowAssign(false);
  };

  if (loading) return <div className="p-6"><Loading what="ticket" /></div>;
  if (!t) return (
    <div className="space-y-4 p-6">
      <Link href="/cyber-assurance/helpdesk/tickets" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={15} /> Tickets</Link>
      {error ? <ErrorBanner msg={error} /> : <div className="mt-10 text-center text-slate-500">Ticket not found.</div>}
    </div>
  );

  const agents: any[] = agentsData?.agents || [];
  const teams: any[] = teamsData?.teams || [];
  const departments: any[] = (deptData?.departments || []).filter((d: any) => d.enabled);
  const customers: any[] = custData?.customers || [];
  const priorities: string[] = meta?.priorities || [];
  const types: string[] = meta?.ticket_types || [];
  const statuses: { name: string; category?: string }[] = meta?.statuses || [];
  const cannedList: any[] = canned?.responses || [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <Link href="/cyber-assurance/helpdesk/tickets" className="mb-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-slate-400 hover:text-slate-600"><ArrowLeft size={13} /> Tickets</Link>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="font-mono text-[11.5px] text-slate-400">
              #{t.name || name}{t.process ? ` · ${t.process === "service_request" ? "Service request" : t.process.charAt(0).toUpperCase() + t.process.slice(1)}` : ""}
            </div>
            <h1 className="mt-0.5 truncate text-[16.5px] font-semibold tracking-[-0.01em] text-[var(--color-text)]" title={t.subject || undefined}>{t.subject || `Ticket ${name}`}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip value={t.status} />
              <Chip value={t.priority} map={PRIORITY_CHIP} />
              {(t.severity || t.cve_id) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
                  <ShieldAlert size={11} />{[t.severity, t.cve_id].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button onClick={() => { setTab("reply"); resetDraft(); setComposerOpen(true); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-base)] px-3 text-[13px] font-medium text-white hover:opacity-90"><MessageSquare size={14} /> Reply</button>
            {statuses.length > 0 ? (
              <select value="" onChange={(e) => { if (e.target.value) act("update", { status: e.target.value }, `Status → ${e.target.value}.`); }}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-600 hover:bg-slate-50 focus:outline-none">
                <option value="">Set status…</option>
                {statuses.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <button onClick={() => act("status", { status: "Resolved" }, "Ticket resolved.")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-medium text-emerald-700 hover:bg-emerald-100"><CheckCircle2 size={14} /> Resolve</button>
            )}
            <button onClick={() => act("status", { status: "Closed" }, "Ticket closed.")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-600 hover:bg-slate-50"><XCircle size={14} /> Close</button>
            <button onClick={() => setShowAssign((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-600 hover:bg-slate-50"><UserPlus size={14} /> Assign</button>
            {showAssign && (
              <div className="absolute right-0 top-11 z-10 w-64 space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-slate-400">Agent</div>
                  <select defaultValue={t.agent || ""} onChange={(e) => assign(e.target.value || null, undefined)}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                    <option value="">Unassigned</option>
                    {agents.map((a) => <option key={a.name} value={a.email || a.name}>{a.agent_name || a.email}</option>)}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-slate-400">Team</div>
                  <select defaultValue={t.team || ""} onChange={(e) => assign(undefined, e.target.value || null)}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                    <option value="">No team</option>
                    {teams.map((tm) => <option key={tm.name} value={tm.name}>{tm.team_name || tm.name}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        {note && <div className="mt-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-500">{note}</div>}
      </div>

      {/* Property toolbar — ONE non-scrolling line of quick-edit fields. Weighted
          columns (minmax(0,fr)) so long values (Department, Assignee) get the width
          they need and short ones (Priority) stay tight — never clipped, never
          horizontally scrollable. The two long-valued, least-triaged fields
          (Customer, Contact) fold into "More" so all 8 stay editable without
          crowding — the spacious one-line treatment of the Vulnerability Register. */}
      <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-2.5">
        <div className="grid items-start gap-x-3" style={{ gridTemplateColumns: "minmax(0,2.3fr) minmax(0,1.9fr) minmax(0,2.9fr) minmax(0,3.3fr) minmax(0,3.2fr) minmax(0,3.4fr) max-content" }}>
          <PropField label="Status">
            {statuses.length > 0 ? (
              <ComboBoxInput ariaLabel="Status" value={t.status || ""} allowCustom={false} placeholder="— Select —"
                options={statuses.map((s) => ({ value: s.name, label: s.name }))}
                onChange={(v) => { if (v) act("update", { status: v }, "Status updated."); }} />
            ) : <Chip value={t.status} />}
          </PropField>
          <PropField label="Priority">
            {priorities.length > 0 ? (
              <ComboBoxInput ariaLabel="Priority" value={t.priority || ""} allowCustom={false} placeholder="— Select —"
                options={priorities.map((p) => ({ value: p, label: p }))}
                onChange={(v) => { if (v) act("update", { priority: v }, "Priority updated."); }} />
            ) : <Chip value={t.priority} map={PRIORITY_CHIP} />}
          </PropField>
          <PropField label="Ticket type">
            {types.length > 0 ? (
              <ComboBoxInput ariaLabel="Ticket type" value={t.ticket_type || ""} allowCustom={false} placeholder="Unset"
                options={types.map((ty) => ({ value: ty, label: ty }))}
                onChange={(v) => act("update", { ticket_type: v }, "Type updated.")} />
            ) : (t.ticket_type || <span className="text-slate-300">Unset</span>)}
          </PropField>
          <PropField label="Department">
            <ComboBoxInput ariaLabel="Department" value={t.department_id ? String(t.department_id) : ""} allowCustom={false} displayLabelInsteadOfValue
              disabled={!departments.length} placeholder={departments.length ? "— Select —" : "No departments"}
              options={departments.map((d) => ({ value: String(d.id), label: d.name }))}
              onChange={(v) => act("update", { department_id: v ? Number(v) : null }, "Department updated.")} />
          </PropField>
          <PropField label="Team">
            <ComboBoxInput ariaLabel="Team" value={t.team || ""} allowCustom={false} displayLabelInsteadOfValue
              disabled={!teams.length} placeholder={teams.length ? "Unassigned" : "No teams"}
              options={teams.filter((tm) => !tm.disabled).map((tm) => ({ value: tm.name, label: tm.team_name || tm.name }))}
              onChange={(v) => assign(undefined, v || null)} />
          </PropField>
          <PropField label="Assignee">
            <ComboBoxInput ariaLabel="Assignee" value={t.agent || ""} allowCustom={false} displayLabelInsteadOfValue
              disabled={!agents.length} placeholder="Unassigned"
              options={agents.map((a) => ({ value: a.email || a.name || "", label: a.agent_name || a.email || a.name || "" }))}
              onChange={(v) => assign(v || null, undefined)} />
          </PropField>
          {/* Customer + Contact (longest values, rarely retriaged) — kept editable
              in a popover so the inline lane never scrolls or clips. */}
          <div className="relative self-end">
            <button onClick={() => setShowMore((v) => !v)}
              className={`inline-flex h-[34px] items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors ${showMore ? "border-[var(--color-base)] text-[var(--color-base)]" : "border-slate-200 bg-white text-slate-600 hover:bg-white"}`}>
              More <ChevronDown size={13} className={`transition-transform ${showMore ? "rotate-180" : ""}`} />
            </button>
            {showMore && (
              <div className="absolute right-0 top-10 z-30 w-64 space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                <PropField label="Customer">
                  <ComboBoxInput ariaLabel="Customer" value={t.customer_id ? String(t.customer_id) : ""} allowCustom={false} displayLabelInsteadOfValue
                    disabled={!customers.length} placeholder={customers.length ? "— None —" : "No customers"}
                    options={customers.map((c) => ({ value: String(c.name), label: c.customer_name || c.name }))}
                    onChange={(v) => act("update", { customer_id: v ? Number(v) : null }, "Customer updated.")} />
                </PropField>
                <PropField label="Contact">
                  <input key={t.contact || ""} defaultValue={t.contact || ""} type="email" placeholder="person@company.com"
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.contact || "")) act("update", { contact: v || null }, "Contact updated."); }}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[var(--color-base)]" />
                </PropField>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {/* Description — the ticket body, always at the top of the thread. */}
            {t.description && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <MessageSquare size={13} /> Description
                  <span className="ml-auto font-normal normal-case text-slate-400">
                    {t.source_kind === "vulnerability" ? "Raised from a vulnerability finding" : (t.contact || t.raised_by || t.customer || "Requester")}
                  </span>
                </div>
                <div className="break-words text-[13px] leading-relaxed text-slate-600">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{t.description}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* On-demand composer — collapsed to two buttons until you reply/note,
                so the thread isn't crowded by an always-open box. */}
            <div className="rounded-xl border border-slate-200 bg-white">
              {!composerOpen ? (
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <button onClick={() => { setTab("reply"); resetDraft(); setComposerOpen(true); }}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--color-base)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"><MessageSquare size={14} /> Reply</button>
                  <button onClick={() => { setTab("comment"); resetDraft(); setComposerOpen(true); }}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"><StickyNote size={14} /> Add note</button>
                  <span className="ml-auto text-[11px] text-slate-400">Reply the requester sees, or an internal note they don't.</span>
                </div>
              ) : (
                <div className="p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <button onClick={() => { if (tab !== "reply") { setTab("reply"); resetDraft(); } }} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${tab === "reply" ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}><MessageSquare size={14} /> Reply</button>
                    <button onClick={() => { if (tab !== "comment") { setTab("comment"); resetDraft(); } }} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${tab === "comment" ? "bg-amber-100 text-amber-800" : "text-slate-500"}`}><StickyNote size={14} /> Internal note</button>
                    {tab === "reply" && (
                      <button onClick={() => setShowCc((v) => !v)} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${showCc ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}><Mail size={14} /> Cc/Bcc</button>
                    )}
                    {tab === "reply" && cannedList.length > 0 && (
                      <select value={savedReply} onChange={(e) => {
                        const r = cannedList.find((c) => c.name === e.target.value);
                        if (r) { const add = r.message || r.title || ""; setDraft((d) => (d && !isEmptyHtml(d) ? d : "") + add); setComposerKey((k) => k + 1); setSavedReply(""); }
                      }} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500">
                        <option value="">Insert canned reply…</option>
                        {cannedList.map((c) => <option key={c.name} value={c.name}>{c.title || c.name}</option>)}
                      </select>
                    )}
                    <button onClick={() => { setComposerOpen(false); resetDraft(); }} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Close composer"><XCircle size={16} /></button>
                  </div>
                  <div className="mb-2 text-[11px] text-slate-400">
                    {tab === "reply"
                      ? <>Reply goes to <span className="font-medium text-slate-600">{t.contact || t.raised_by || t.customer || "the requester"}</span>.</>
                      : "Internal note — visible to agents only, not the requester."}
                  </div>
                  {tab === "reply" && showCc && (
                    <div className="mb-2 space-y-1.5">
                      <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc (comma-separated)"
                        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-[var(--color-base)] focus:outline-none" />
                      <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Bcc (comma-separated)"
                        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-[var(--color-base)] focus:outline-none" />
                    </div>
                  )}
                  {tab === "reply" ? (
                    <RichComposer key={composerKey} value={draft} onChange={setDraft} />
                  ) : (
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
                      placeholder="Add an internal note…"
                      className="w-full resize-none rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm focus:border-[var(--color-base)] focus:outline-none" />
                  )}
                  {/* attachments — persisted per ticket (type-allowlisted, 10MB max) */}
                  <div className="mt-2 space-y-1.5">
                    {attachments.length > 0 && (
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
                    )}
                    <div className="flex items-center justify-between">
                      <input ref={fileInputRef} type="file" className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" onChange={onPickFile} />
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                        <Paperclip size={13} /> {uploading ? "Uploading…" : "Attach file"}
                      </button>
                      <button onClick={send} disabled={tab === "comment" ? !draft.trim() : isEmptyHtml(draft)} className="flex items-center gap-1.5 rounded-lg bg-[var(--color-base)] px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-40"><Send size={14} /> {tab === "reply" ? "Send reply" : "Add note"}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* conversation tabs: Replies (default) / Comments / Activity */}
            <div className="flex items-center gap-1 border-b border-slate-100">
              {([["replies", "Replies", replies.length, MessageSquare], ["comments", "Comments", comments.length, StickyNote], ["activity", "Activity", activity.length, Activity]] as const).map(([k, label, count, Icon]) => (
                <button key={k} onClick={() => setConvTab(k)}
                  className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${convTab === k ? "border-[var(--color-base)] text-[var(--color-text)]" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  <Icon size={14} /> {label} <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-500">{count}</span>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <MessageSquare size={22} className="text-slate-300" />
                <p className="text-[13px] font-medium text-slate-500">
                  {convTab === "replies" ? "No replies yet" : convTab === "comments" ? "No internal notes" : "No activity yet"}
                </p>
                <p className="max-w-xs text-[12px] text-slate-400">
                  {convTab === "replies"
                    ? "Use Reply above to respond to the requester."
                    : convTab === "comments"
                    ? "Add a note your team can see but the requester can't."
                    : "Status changes and assignments show up here."}
                </p>
              </div>
            ) : shown.map((m, i) => <TimelineItem key={i} m={m} />)}
          </div>
        </div>

        <aside className="w-[280px] shrink-0 space-y-3 overflow-y-auto border-l border-slate-200 bg-white px-4 py-5">
          {/* Change workflow: surface type/risk + the approval state and the
              submit→CAB / approve / schedule actions on the detail itself, so a
              change can be driven (and its CAB resolved from the risk matrix)
              without going to the Changes list. ApprovalPanel below shows the
              vote detail once an approval is open. */}
          {t.process === "change" && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Change</span>
                <ChangeActions change={data} onChanged={reload} />
              </div>
              <PropRow label="Change type"><span className="capitalize">{t.change_type || <span className="text-slate-300">—</span>}</span></PropRow>
              <PropRow label="Risk"><span className="capitalize">{t.change_risk || <span className="text-slate-300">—</span>}</span></PropRow>
              <PropRow label="Approval"><ApprovalBadge state={t.approval_state} /></PropRow>
            </div>
          )}
          {data?.approval && <ApprovalPanel ap={data.approval} />}
          <RelatedTickets name={t.name || name} process={t.process} related={data?.related} onChanged={reload} />
          <Knowledge name={t.name || name} kbLinks={data?.kb_links} onChanged={reload} />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Details</h3>
          <PropRow label="Source">
            {t.source_kind === "vulnerability" && t.source_finding_id ? (
              <Link href={`/cyber-assurance/vulnerabilities/${encodeURIComponent(String(t.source_finding_id))}`} className="font-medium text-[var(--color-base)] hover:underline">
                {t.source || "Vulnerability finding"}
              </Link>
            ) : (t.source || <span className="text-slate-300">—</span>)}
          </PropRow>
          {/* Affected CI — agents link/change/clear the configuration item this ticket is about. */}
          <div>
            <div className="mb-1 text-[11px] font-medium text-slate-400">Affected CI</div>
            <AffectedCiPicker
              value={t.ci || null}
              onChange={(ci) => act("update", { ci_id: ci?.id ?? null }, ci ? "Affected CI updated." : "Affected CI cleared.")}
            />
            {t.ci && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                <Link href="/cyber-assurance/helpdesk/admin/cmdb" className="inline-flex items-center gap-1 font-medium text-[var(--color-base)] hover:underline"><ExternalLink size={12} /> Open in CMDB</Link>
                {t.ci.managed_by_inventory && inventoryUrl(t.ci) && (
                  <Link href={inventoryUrl(t.ci) as string} className="inline-flex items-center gap-1 font-medium text-[var(--color-base)] hover:underline"><ExternalLink size={12} /> Open in inventory</Link>
                )}
              </div>
            )}
            {t.business_service?.name && (
              <div className="mt-1.5 text-[11.5px] text-slate-500">Business service: <span className="font-medium text-slate-700">{t.business_service.name}</span></div>
            )}
            {t.ci?.security && <CiSecurity sec={t.ci.security} assetId={t.ci.ava_asset_id} />}
          </div>
          {/* Impacted CIs (changes): the SET beyond the primary CI; unioned for CAB exposure. */}
          {t.process === "change" && (
            <ImpactedCis name={t.name || name} impacted={data?.impacted_cis} onChanged={reload} />
          )}
          <div className="border-t border-slate-100 pt-1" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">SLA{sla.policy ? ` · ${sla.policy}` : ""}</span>
            {sla.agreement_status && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${sla.breached ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{sla.agreement_status}</span>
            )}
          </div>
          <PropRow label="First response by"><span className="mr-auto">{fmt(t.response_by)}</span><SlaBadge due={t.response_by} done={!!sla.first_responded_on || doneRe.test(t.status || "")} /></PropRow>
          <PropRow label="Resolution by"><span className="mr-auto">{fmt(t.resolution_by)}</span><SlaBadge due={t.resolution_by} done={!!sla.resolution_date || /resolved|closed/i.test(t.status || "")} /></PropRow>
          {t.feedback_rating ? <PropRow label="CSAT">{"★".repeat(Math.round((t.feedback_rating || 0) * 5))} <span className="ml-1 text-xs text-slate-400">{Math.round((t.feedback_rating || 0) * 5)}/5</span></PropRow> : null}
          <PropRow label="Created">{fmt(t.created || t.creation)}</PropRow>
          {(t.cve_id || t.finding_id) && (
            <PropRow label="Related finding">
              <Link
                href={t.finding_id ? `/vulnerabilities/${encodeURIComponent(String(t.finding_id))}` : `/vulnerabilities?q=${encodeURIComponent(String(t.cve_id))}`}
                className="text-primary-600 hover:underline"
              >
                {String(t.cve_id || `Finding #${t.finding_id}`)} →
              </Link>
            </PropRow>
          )}
        </aside>
      </div>
    </div>
  );
}

/** CAB / approval read surface on the ticket detail (flow #4): state, quorum
 * progress, the required CAB roles and every vote cast — so an agent sees the
 * board's decision, not just the Approve/Reject buttons. Hidden when the ticket
 * has no approval (data.approval === null). */
function ApprovalPanel({ ap }: { ap: any }) {
  const state = String(ap?.state || "pending").toLowerCase();
  const q = ap?.required_quorum || 1;
  const approved = ap?.approve_count || 0;
  const rejected = ap?.reject_count || 0;
  const votes: any[] = Array.isArray(ap?.votes) ? ap.votes : [];
  const roles: string[] = Array.isArray(ap?.required_role_codes) ? ap.required_role_codes : [];
  const STATE: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-rose-50 text-rose-600",
  };
  const DEC: Record<string, string> = {
    approve: "text-emerald-600", reject: "text-rose-600", abstain: "text-slate-400",
  };
  const kindLabel = ap?.kind === "ecab" ? "Emergency CAB" : ap?.kind === "cab" ? "CAB approval" : "Approval";
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <ShieldCheck size={13} /> {kindLabel}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE[state] || "bg-slate-100 text-slate-600"}`}>
          {state.replace(/_/g, " ")}
        </span>
      </div>
      <div className="mb-2">
        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
          <span>Approvals</span>
          <span className="font-medium">{approved} of {q}{rejected ? ` · ${rejected} rejected` : ""}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (approved / q) * 100)}%` }} />
        </div>
      </div>
      {roles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {roles.map((r) => (
            <span key={r} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">{r}</span>
          ))}
        </div>
      )}
      {votes.length === 0 ? (
        <p className="text-[11.5px] text-slate-400">No votes yet.</p>
      ) : (
        <ul className="space-y-1">
          {votes.map((v, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="min-w-0 truncate text-slate-600">{v.approver}{v.role ? ` · ${v.role}` : ""}</span>
              <span className={`shrink-0 font-semibold ${DEC[(v.decision || "").toLowerCase()] || "text-slate-400"}`}>{v.decision}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Help Desk ↔ ComplyVerse-security linkage: the affected asset's OWN open-vuln / risk
 * snapshot (read-only, mirrored by the CMDB sync). Hidden when the CI carries no
 * security snapshot. Deep-links into the asset's risk/vuln view. */
function CiSecurity({ sec, assetId }: { sec: any; assetId?: number | null }) {
  const open = Number(sec?.open) || 0;
  const risk = sec?.risk_score;
  const last = sec?.last_finding_at;
  const lastFmt = last && !isNaN(new Date(last).getTime()) ? new Date(last).toLocaleDateString() : null;
  const SEV: [string, string][] = [
    ["critical", "bg-red-100 text-red-700"],
    ["high", "bg-orange-100 text-orange-700"],
    ["medium", "bg-amber-100 text-amber-800"],
    ["low", "bg-sky-100 text-sky-700"],
  ];
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <ShieldAlert size={12} /> Asset security
        </span>
        {typeof risk === "number" && (
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Risk {risk}</span>
        )}
      </div>
      {open === 0 ? (
        <p className="text-[11.5px] text-emerald-600">No open vulnerabilities.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {SEV.map(([k, cls]) => (Number(sec?.[k]) > 0
            ? <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{sec[k]} {k}</span>
            : null))}
          <span className="text-[11px] text-slate-500">· {open} open</span>
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {lastFmt && <span className="text-slate-400">Last finding {lastFmt}</span>}
        {assetId != null && (
          <Link href={`/cyber-assurance/risk-posture/asset/${assetId}`} className="inline-flex items-center gap-1 font-medium text-[var(--color-base)] hover:underline">
            <ExternalLink size={11} /> View risk &amp; vulns
          </Link>
        )}
      </div>
    </div>
  );
}
