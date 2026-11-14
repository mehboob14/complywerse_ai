"use client";

/**
 * Problem process panel — root-cause / workaround / resolution editing, the
 * known-error flag, and incident linking. The conversation lives on the shared
 * ticket detail; this panel owns only the ITIL problem-management fields.
 *   PUT  /helpdesk/problems/{id}            root_cause / workaround / problem_resolution
 *   POST /helpdesk/problems/{id}/known-error  {known_error:bool}
 *   POST /helpdesk/problems/{id}/link-incident   {incident_id:int}
 *   POST /helpdesk/problems/{id}/unlink-incident {incident_id:int}
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Link2, Unlink } from "lucide-react";
import { useHd } from "../_ui";
import { Modal, Field, Textarea, Select, Btn, Toggle, FormError, hdCall } from "../_admin";

/** linked_incident_ids is a JSON string ("[12,15]") or an array — tolerate both. */
export function linkedIds(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => !Number.isNaN(n));
  if (typeof v === "string" && v.trim()) {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a.map(Number).filter((n) => !Number.isNaN(n)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function ProblemPanel({ problem, onClose, onChanged }: { problem: any; onClose: () => void; onChanged: () => void }) {
  const incidents = useHd<{ tickets: any[] }>("/helpdesk/incidents");
  const [rootCause, setRootCause] = useState(problem.root_cause || "");
  const [workaround, setWorkaround] = useState(problem.workaround || "");
  const [resolution, setResolution] = useState(problem.problem_resolution || "");
  const [knownError, setKnownError] = useState(Boolean(problem.known_error));
  const [linked, setLinked] = useState<number[]>(linkedIds(problem.linked_incident_ids));
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reverse surface (Batch 4 linkage A): the change(s) raised from this problem,
  // read from the ticket detail's `related` block.
  const detail = useHd<any>(`/helpdesk/tickets/${encodeURIComponent(problem.name)}`);
  const relatedChanges: any[] = detail.data?.related?.changes || [];

  const id = encodeURIComponent(problem.name);
  const incList = incidents.data?.tickets || [];
  const byId = useMemo(() => {
    const m = new Map<number, any>();
    for (const t of incList) m.set(Number(t.name), t);
    return m;
  }, [incList]);
  const linkable = incList.filter((t) => !linked.includes(Number(t.name)));

  const save = async () => {
    setBusy(true); setErr(null);
    const upd = await hdCall("put", `/helpdesk/problems/${id}`, {
      root_cause: rootCause.trim() || null,
      workaround: workaround.trim() || null,
      problem_resolution: resolution.trim() || null,
    });
    if (!upd.ok) { setBusy(false); setErr(upd.error || "Could not save."); return; }
    if (Boolean(problem.known_error) !== knownError) {
      const ke = await hdCall("post", `/helpdesk/problems/${id}/known-error`, { known_error: knownError });
      if (!ke.ok) { setBusy(false); setErr(ke.error || "Saved, but the known-error flag didn't update."); return; }
    }
    setBusy(false);
    onChanged();
  };

  const link = async () => {
    const incident_id = Number(pick);
    if (!incident_id) return;
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/problems/${id}/link-incident`, { incident_id });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not link that incident."); return; }
    setLinked((l) => [...l, incident_id]);
    setPick("");
  };

  const unlink = async (incident_id: number) => {
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/problems/${id}/unlink-incident`, { incident_id });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not unlink that incident."); return; }
    setLinked((l) => l.filter((x) => x !== incident_id));
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={`Problem #${problem.name}`}
      subtitle={problem.subject || undefined}
      wide
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Close</Btn>
          <Btn variant="primary" onClick={save} busy={busy}>Save</Btn>
        </>
      }
    >
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between rounded-[9px] border border-[#E2E5EC] bg-[#F9FAFC] px-3 py-2.5">
          <div>
            <p className="m-0 text-[12.5px] font-semibold text-[#0F172A]">Known error</p>
            <p className="m-0 text-[11px] text-[#64748B]">Root cause understood, workaround available.</p>
          </div>
          <Toggle checked={knownError} onChange={setKnownError} />
        </div>

        <Field label="Root cause"><Textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="What is actually causing this?" /></Field>
        <Field label="Workaround"><Textarea value={workaround} onChange={(e) => setWorkaround(e.target.value)} placeholder="Temporary mitigation while the fix is pending." /></Field>
        <Field label="Resolution"><Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Permanent fix / RCA outcome." /></Field>

        <div>
          <p className="mb-1 text-[11.5px] font-semibold text-[#475569]">Linked incidents</p>
          {linked.length === 0 ? (
            <p className="m-0 mb-2 text-[12px] text-[#94A3B8]">No incidents linked yet.</p>
          ) : (
            <ul className="m-0 mb-2 flex list-none flex-col gap-1 p-0">
              {linked.map((lid) => {
                const t = byId.get(lid);
                return (
                  <li key={lid} className="flex items-center gap-2 rounded-[9px] border border-[#E2E5EC] bg-white px-2.5 py-1.5 text-[12.5px]">
                    <Link href={`/cyber-assurance/helpdesk/tickets/${lid}`} className="font-mono text-[11px] text-[#005B96]">#{lid}</Link>
                    <span className="min-w-0 flex-1 truncate text-[#334155]">{t?.subject || "(incident)"}</span>
                    <button onClick={() => unlink(lid)} disabled={busy} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50">
                      <Unlink size={13} /> Unlink
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1">
              <option value="">— Select an incident —</option>
              {linkable.map((t) => (
                <option key={t.name} value={t.name}>#{t.name} · {t.subject || "(no subject)"}</option>
              ))}
            </Select>
            <Btn variant="ghost" icon={<Link2 size={14} />} onClick={link} disabled={busy || !pick}>Link</Btn>
          </div>
        </div>

        {relatedChanges.length > 0 && (
          <div>
            <p className="mb-1 text-[11.5px] font-semibold text-[#475569]">Changes raised from this problem</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {relatedChanges.map((c) => (
                <li key={c.name} className="flex items-center gap-2 rounded-[9px] border border-[#E2E5EC] bg-white px-2.5 py-1.5 text-[12.5px]">
                  <Link href={`/cyber-assurance/helpdesk/tickets/${c.name}`} className="font-mono text-[11px] text-[#005B96]">#{c.name}</Link>
                  <span className="min-w-0 flex-1 truncate text-[#334155]">{c.subject || "(change)"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
