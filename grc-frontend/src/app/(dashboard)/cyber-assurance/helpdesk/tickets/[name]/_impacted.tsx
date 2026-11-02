"use client";

/**
 * Impacted CIs (Batch 4 linkage B) — the SET of configuration items a change
 * touches beyond its single primary "Affected CI". Reuses the shared
 * AffectedCiPicker to add, lists the linked CIs with their exposure badges, and
 * removes one per click. The CAB exposure escalation on the server unions these
 * with the primary CI, so adding an internet-facing / PCI CI here forces the
 * change to CAB. Self-contained; drives the impacted-cis endpoints only.
 *   GET    /helpdesk/tickets/{name}/impacted-cis
 *   POST   /helpdesk/tickets/{name}/impacted-cis        {ci_id}
 *   DELETE /helpdesk/tickets/{name}/impacted-cis/{ci_id}
 */
import { useState } from "react";
import { X } from "lucide-react";
import { AffectedCiPicker, CiBadges, ciTypeLabel, type CiLite } from "../../_ci";
import { hdCall } from "../../_admin";

export function ImpactedCis({ name, impacted, onChanged }: {
  name: string;
  impacted?: CiLite[] | null;
  onChanged?: () => void;
}) {
  const list = impacted || [];
  const id = encodeURIComponent(name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async (ci: CiLite | null) => {
    if (!ci) return;
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/tickets/${id}/impacted-cis`, { ci_id: ci.id });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not add that CI."); return; }
    onChanged?.();
  };
  const remove = async (ciId: number) => {
    setBusy(true); setErr(null);
    const r = await hdCall("delete", `/helpdesk/tickets/${id}/impacted-cis/${ciId}`);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not remove that CI."); return; }
    onChanged?.();
  };

  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-400">Impacted CIs</div>
      {list.length === 0 ? (
        <p className="mb-1.5 text-[11.5px] text-slate-300">No additional impacted CIs.</p>
      ) : (
        <ul className="mb-1.5 space-y-1">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-700">{c.name || c.code || `CI #${c.id}`}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-slate-400">{ciTypeLabel(c)}</span>
                  <CiBadges ci={c} />
                </span>
              </span>
              <button onClick={() => remove(c.id)} disabled={busy} title="Remove impacted CI"
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AffectedCiPicker value={null} onChange={add} disabled={busy} />
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}
