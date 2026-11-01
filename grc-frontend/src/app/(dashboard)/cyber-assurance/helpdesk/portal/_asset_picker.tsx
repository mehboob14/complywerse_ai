"use client";

/**
 * Portal asset picker — lets a requester attach the affected asset (CMDB CI) to
 * a request or report. With no query it shows the caller's OWN assets
 * (/helpdesk/portal/assets, owner == them); typing searches the whole tenant
 * CMDB by name/tag so they can find a shared asset. Optional everywhere — an
 * asset-less request still submits. Sets ci_id on the created ticket.
 */
import { useEffect, useRef, useState } from "react";
import { Search, X, Server } from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";

type Asset = { id: number; code: string; name: string; type: string | null; owner: string | null; mine: boolean };
export type PickedAsset = { id: number; name: string };

export function AssetPicker({ value, onChange }: {
  value: PickedAsset | null;
  onChange: (a: PickedAsset | null) => void;
}) {
  const [q, setQ] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  // Refetch on query change; a sequence guard drops out-of-order responses.
  useEffect(() => {
    if (value) return; // don't fetch while something is selected
    const mine = ++seq.current;
    setLoading(true);
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    apiClient
      .get(`/helpdesk/portal/assets${qs}`)
      .then((r) => { if (mine === seq.current) setAssets(r.data?.assets || []); })
      .catch(() => { if (mine === seq.current) setAssets([]); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[#005B96]/30 bg-[#005B96]/5 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-[#0F172A]">
          <Server size={14} className="shrink-0 text-[#005B96]" />
          <span className="truncate">{value.name}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} aria-label="Remove asset"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-500 hover:bg-white">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search your assets by name or tag…"
          aria-label="Search assets"
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15"
        />
      </div>
      {(open || q) && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {loading ? (
            <div className="px-3 py-2 text-[12.5px] text-slate-400">Loading…</div>
          ) : assets.length === 0 ? (
            <div className="px-3 py-2 text-[12.5px] text-slate-400">
              {q.trim() ? "No matching assets." : "No assets available — type to search."}
            </div>
          ) : (
            assets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { onChange({ id: a.id, name: a.name }); setOpen(false); }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#F6F7FB]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-[#0F172A]">{a.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {[a.code, a.type, a.owner].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {a.mine && (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Mine</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
