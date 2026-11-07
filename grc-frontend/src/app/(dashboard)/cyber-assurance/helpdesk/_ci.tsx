"use client";

// Shared CMDB-CI bits used wherever a ticket points at a configuration item:
// the inventory-signal badges (exposure / PCI / internet-facing), the status/
// criticality chip maps, the "open in inventory" URL helper, and the reusable
// Affected-CI picker. Extracted from the CMDB admin page so the New-Ticket form,
// the ticket detail CI card and the CMDB modal all render the same thing.
// Everything is null-safe — a null `ci` renders nothing, never crashes.
// Private file: not a route.
import { useEffect, useMemo, useState } from "react";
import { Boxes, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";

const CMDB = "/helpdesk/admin/cmdb";

// ── inventory-signal palettes (kept identical to the CMDB admin page) ────────
export const EXPOSURE_CHIP: Record<string, string> = { external: "bg-rose-50 text-rose-700", internal: "bg-slate-100 text-slate-600" };
export const CATEGORY_CHIP: Record<string, string> = {
  easm: "bg-fuchsia-50 text-fuchsia-700", credential: "bg-emerald-50 text-emerald-700",
  uncredential: "bg-sky-50 text-sky-700", manual: "bg-slate-100 text-slate-600", none: "bg-slate-100 text-slate-500",
};
export const CATEGORY_LABEL: Record<string, string> = { easm: "EASM", credential: "Credentialed", uncredential: "Uncredentialed", manual: "Manual", none: "Manual" };
export const CI_STATUS_CHIP: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700", planned: "bg-blue-50 text-blue-700", in_use: "bg-emerald-50 text-emerald-700",
  maintenance: "bg-amber-50 text-amber-700", retired: "bg-slate-100 text-slate-500",
};
export const CRIT_CHIP: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-sky-100 text-sky-700",
};

/** A lightweight CI reference as it rides on /cis rows and the ticket `ci` object. */
export type CiLite = {
  id: number;
  code?: string | null;
  name?: string | null;
  ci_type?: string | null;
  ci_kind?: string | null;
  exposure?: string | null;
  pci?: boolean | null;
  internet_facing?: boolean | null;
  managed_by_inventory?: boolean | null;
  ava_asset_id?: number | null;
  parent_ci_id?: number | null;
  child_count?: number | null;
};

const CI_KIND_LABEL: Record<string, string> = { domain: "Domain", endpoint: "Endpoint", host: "Host", software: "Software" };

/** Human type label for a CI: the CI-type name, else the inventory kind, else —. */
export function ciTypeLabel(c?: Partial<CiLite> | null): string {
  if (!c) return "—";
  if (c.ci_type) return c.ci_type;
  if (c.ci_kind && CI_KIND_LABEL[c.ci_kind]) return CI_KIND_LABEL[c.ci_kind];
  return "—";
}

/**
 * Label a CI's contained children by the parent's kind: a domain contains
 * endpoints, a host contains installed software, anything else just "children".
 */
export function childNoun(c: Partial<CiLite> | null | undefined, n: number): string {
  if (c?.ci_kind === "domain") return n === 1 ? "endpoint" : "endpoints";
  if (c?.ci_kind === "host") return n === 1 ? "installed app" : "installed apps";
  return n === 1 ? "child" : "children";
}

/** The real ComplyVerse IT-asset detail route (/assets/{id}) for a linked CI, else null. */
export function inventoryUrl(c?: (Partial<CiLite> & { attributes?: any }) | null): string | null {
  if (!c) return null;
  const u = c.attributes?.ava?.asset_url;
  if (typeof u === "string" && u.startsWith("/assets/")) return u;
  const id = c.ava_asset_id;
  return id != null ? `/assets/${id}` : null;
}

export function MiniBadge({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`}>{children}</span>;
}

/** Exposure / PCI / internet-facing pills for a CI (renders nothing when a CI has none). */
export function CiBadges({ ci }: { ci?: Partial<CiLite> | null }) {
  if (!ci) return null;
  return (
    <>
      {ci.exposure && <MiniBadge className={EXPOSURE_CHIP[ci.exposure] || "bg-slate-100 text-slate-600"}>{ci.exposure === "external" ? "External" : "Internal"}</MiniBadge>}
      {ci.pci && <MiniBadge className="bg-red-50 text-red-700">PCI</MiniBadge>}
      {ci.internet_facing && <MiniBadge className="bg-amber-50 text-amber-700">Internet-facing</MiniBadge>}
    </>
  );
}

const asList = (d: any, ...keys: string[]): CiLite[] => {
  if (Array.isArray(d)) return d as CiLite[];
  for (const k of keys) if (Array.isArray(d?.[k])) return d[k] as CiLite[];
  return [];
};

// ── Affected CI picker ───────────────────────────────────────────────────────
// Searchable, tree-aware CI chooser. Fetches the top-level CIs (domains + hosts
// + manual CIs) and the contained CIs (endpoints / software) ONCE each, then
// groups children by parent_ci_id client-side — never a request per node. Used
// in the New-Ticket form (sends ci_id) and the ticket detail CI card.
export function AffectedCiPicker({ value, onChange, disabled }: {
  value?: CiLite | null;            // the currently-linked CI (shown as the selected chip)
  onChange: (ci: CiLite | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tops, setTops] = useState<CiLite[] | null>(null);
  const [children, setChildren] = useState<CiLite[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy one-shot load the first time the panel is opened.
  useEffect(() => {
    if (!open || tops !== null || loading) return;
    let alive = true;
    setLoading(true); setError(null);
    Promise.all([
      apiClient.get(`${CMDB}/cis?top_level=true`),
      apiClient.get(`${CMDB}/cis?top_level=false`),
    ])
      .then(([t, c]) => { if (!alive) return; setTops(asList(t.data, "cis", "items")); setChildren(asList(c.data, "cis", "items")); })
      .catch(() => { if (!alive) return; setTops([]); setChildren([]); setError("Couldn't load configuration items — the CMDB may not be reachable."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // NB: `loading` must stay out of the deps. With it in, setLoading(true)
    // re-runs this effect, whose cleanup flips alive=false on the in-flight
    // fetch, so .then/.finally no-op and the panel is stuck "Loading…" forever.
  }, [open, tops]);

  const childrenByParent = useMemo(() => {
    const m = new Map<number, CiLite[]>();
    (children || []).forEach((c) => { if (c.parent_ci_id != null) m.set(c.parent_ci_id, [...(m.get(c.parent_ci_id) || []), c]); });
    return m;
  }, [children]);

  const needle = q.trim().toLowerCase();
  // Flat match list across every CI (top-level + contained) while searching.
  const flat = useMemo(() => {
    if (!needle) return [];
    return [...(tops || []), ...(children || [])].filter((c) => [c.name, c.code].some((v) => (v || "").toLowerCase().includes(needle)));
  }, [needle, tops, children]);

  const toggle = (id: number) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pick = (c: CiLite | null) => { onChange(c); setOpen(false); setQ(""); };

  const Option = ({ c, depth, expandable, parent }: { c: CiLite; depth: number; expandable?: boolean; parent?: CiLite }) => {
    const isOpen = expandable && expanded.has(c.id);
    const kids = c.child_count || 0;
    const version = (c as any)?.attributes?.version;
    return (
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
        {expandable ? (
          <button type="button" onClick={() => toggle(c.id)} aria-expanded={isOpen} aria-label={isOpen ? "Collapse" : "Expand"}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : <span className="inline-block w-5 shrink-0" aria-hidden />}
        <button type="button" onClick={() => pick(c)}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[#F6F7FB] ${value?.id === c.id ? "bg-[#005B96]/5" : ""}`}>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-medium text-[#334155]">{c.name || c.code || `CI #${c.id}`}</span>
              {expandable && kids > 0 && <span className="shrink-0 text-[11px] text-slate-400">· {kids} {childNoun(c, kids)}</span>}
              {parent?.ci_kind === "host" && version && <span className="shrink-0 font-mono text-[11px] text-slate-400">{version}</span>}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">{ciTypeLabel(c)}</span>
              <CiBadges ci={c} />
            </span>
          </span>
        </button>
      </div>
    );
  };

  return (
    <div>
      {/* Selected state / trigger */}
      {value ? (
        <div className="flex items-start justify-between gap-2 rounded-[9px] border border-[#E2E5EC] bg-white px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-[#0F172A]">{value.name || value.code || `CI #${value.id}`}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">{ciTypeLabel(value)}</span>
              <CiBadges ci={value} />
            </div>
          </div>
          {!disabled && (
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-[#005B96] hover:bg-[#005B96]/5">Change</button>
              <button type="button" onClick={() => pick(null)} aria-label="Clear affected CI" className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={14} /></button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 rounded-[9px] border border-dashed border-[#E2E5EC] bg-white px-3 py-2 text-left text-[13px] text-[#94A3B8] hover:border-[#005B96] hover:text-[#334155] disabled:cursor-not-allowed disabled:opacity-60">
          <span className="inline-flex items-center gap-2"><Boxes size={14} /> Select affected CI…</span>
          <ChevronDown size={14} />
        </button>
      )}

      {/* Inline expanding panel (avoids dropdown clipping inside scrolling modals) */}
      {open && !disabled && (
        <div className="mt-1.5 rounded-[10px] border border-[#EEF1F5] bg-[#F9FAFB] p-2">
          <div className="relative mb-1.5">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search by name or code…"
              className="w-full rounded-md border border-[#E2E5EC] bg-white py-1.5 pl-8 pr-3 text-[12.5px] outline-none focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15" />
          </div>
          <div className="max-h-[260px] space-y-0.5 overflow-y-auto">
            {value && (
              <button type="button" onClick={() => pick(null)} className="block w-full rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-rose-600 hover:bg-rose-50">Clear selection</button>
            )}
            {error ? (
              <p className="px-2 py-3 text-[12px] text-amber-700">{error}</p>
            ) : loading && tops === null ? (
              <p className="px-2 py-3 text-[12px] text-slate-400">Loading configuration items…</p>
            ) : needle ? (
              flat.length ? flat.map((c) => <Option key={c.id} c={c} depth={0} />) : (
                <p className="px-2 py-3 text-[12px] text-slate-400">No configuration items match “{q}”.</p>
              )
            ) : (tops && tops.length) ? (
              tops.map((c) => {
                const expandable = c.ci_kind === "domain" || (c.child_count || 0) > 0;
                const isOpen = expandable && expanded.has(c.id);
                const kids = isOpen ? (childrenByParent.get(c.id) || []) : [];
                return (
                  <div key={c.id}>
                    <Option c={c} depth={0} expandable={expandable} />
                    {isOpen && (kids.length ? kids.map((k) => <Option key={k.id} c={k} depth={1} parent={c} />) : (
                      <p className="py-1 pl-11 text-[11px] text-slate-400">No endpoints linked to this domain.</p>
                    ))}
                  </div>
                );
              })
            ) : (
              <p className="px-2 py-3 text-[12px] text-slate-400">No configuration items yet. Sync the CMDB from the ComplyVerse inventory first.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
