'use client';

/**
 * Typed-asset detail — the per-platform component card.
 *
 * A server shows VCPU/RAM/OS; a database/router/cloud-account/directory/cluster
 * has a COMPLETELY different model. The backend collects each kind's own facts
 * into `platform_properties` and tags `platform_kind`. Rather than hardcode a
 * field list per kind, this renders GENERICALLY from a status-section contract:
 *
 *   platform_properties = {
 *     // flat identity/summary scalars (strings / numbers / booleans)
 *     engine: "PostgreSQL", version: "16.2", host: "...", port: 5432,
 *     // named SECTIONS: { status, data, note? }
 *     databases:   { status: "discovered",        data: [ {...}, ... ] },
 *     replication: { status: "permission_denied", data: null, note: "must be superuser" },
 *   }
 *
 * status ∈ discovered | permission_denied | not_supported | not_applicable |
 *          unavailable | error
 * data   ∈ array-of-objects (→ table) | array-of-scalars (→ chips) |
 *          object (→ key/value grid) | scalar (→ inline)
 *
 * The header is built from the flat scalars; every section key renders as its
 * own titled sub-section, ordered per-kind (known keys first, then the rest
 * alphabetically). Server assets normally keep their Hardware & Telemetry card,
 * but "server" is supported here too for completeness.
 */
import { Database, Network, Cloud, KeyRound, Boxes, Server } from 'lucide-react';

export const PLATFORM_META: Record<string, { title: string; icon: any }> = {
  database: { title: 'Database Engine', icon: Database },
  network: { title: 'Network Device', icon: Network },
  cloud: { title: 'Cloud Account', icon: Cloud },
  identity: { title: 'Directory', icon: KeyRound },
  cluster: { title: 'Cluster', icon: Boxes },
  server: { title: 'Server', icon: Server },
};

/* ------------------------------------------------------------------ *
 * Per-kind section order. Known section keys render first in this
 * order; any unknown/remaining sections are appended alphabetically.
 * Aliases (a/b) let one logical slot match whichever key the backend
 * emitted (e.g. ec2 vs virtual_machines).
 * ------------------------------------------------------------------ */
const SECTION_ORDER: Record<string, string[]> = {
  database: [
    'instance', 'server', 'databases', 'schemas', 'objects', 'roles', 'users',
    'storage', 'files', 'replication', 'extensions', 'plugins', 'settings', 'security',
  ],
  network: [
    'device', 'hardware', 'interfaces', 'vlans', 'mac_table', 'arp', 'routing',
    'cdp_neighbors', 'config_status',
  ],
  cloud: [
    'account', 'regions', 'vpcs', 'subnets', 'security_groups', 'ec2',
    'virtual_machines', 'ebs_volumes', 'disks', 'network_interfaces', 'nics',
    'rds', 'sql', 's3', 'storage_accounts', 'lambda', 'app_services', 'other',
  ],
  cluster: [
    'cluster', 'nodes', 'namespaces', 'workloads', 'pods', 'containers',
    'services', 'ingress', 'storage', 'network_policies',
  ],
  identity: [
    'forest', 'domain', 'domain_controllers', 'sites', 'ous', 'computers',
    'users', 'groups',
  ],
  server: [
    'identity', 'os', 'cpu', 'memory', 'firmware', 'gpu', 'storage', 'network',
    'services', 'security',
  ],
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function isSection(v: any): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.prototype.hasOwnProperty.call(v, 'status');
}

function humanize(key: string): string {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → camel Case
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksLikeBytes(key: string): boolean {
  return /(bytes|size|_kb|_mb|_gb|disk|storage|memory|capacity|used|free)/i.test(key);
}

function formatBytes(n: number): string {
  if (!isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || Number.isInteger(v) ? 0 : 1)} ${units[i]}`;
}

function formatCell(value: any, key?: string): React.ReactNode {
  if (value === null || value === undefined || value === '' || value === 'null') return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'number' && key) {
    // A `_gb` / `_mb` / `_mhz` suffix means the value is ALREADY in that unit —
    // don't run it through formatBytes (that turned "32" GB into "32 B").
    const u = key.match(/_(gb|mb|kb|tb|mhz|ghz)$/i);
    if (u) return `${value.toLocaleString()} ${u[1].toUpperCase()}`;
    if (looksLikeBytes(key)) return formatBytes(value);
  }
  if (typeof value === 'number') return value.toLocaleString();
  if (Array.isArray(value)) {
    return value.map((x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  }
  if (typeof value === 'object') {
    // nested object inside a cell — keep it short and human
    return Object.entries(value).map(([k, v]) => `${humanize(k)}: ${v}`).join(' · ');
  }
  return String(value);
}

/* ------------------------------------------------------------------ *
 * Status badge
 * ------------------------------------------------------------------ */
const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  discovered: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'discovered' },
  permission_denied: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'no permission' },
  not_supported: { cls: 'bg-slate-100 text-slate-500 border-slate-200', label: 'not supported' },
  not_applicable: { cls: 'bg-slate-100 text-slate-500 border-slate-200', label: 'not applicable' },
  unavailable: { cls: 'bg-slate-100 text-slate-500 border-slate-200', label: 'unavailable' },
  error: { cls: 'bg-red-50 text-red-700 border-red-200', label: 'error' },
};

function StatusBadge({ status, note }: { status: string; note?: string }) {
  const s = STATUS_STYLE[status] || { cls: 'bg-slate-100 text-slate-500 border-slate-200', label: status };
  return (
    <span
      title={note && status !== 'discovered' ? note : undefined}
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Section data renderers
 * ------------------------------------------------------------------ */
function ObjectTable({ rows }: { rows: any[] }) {
  const sample = rows.slice(0, 5);
  const cols: string[] = [];
  for (const r of sample) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
    }
  }
  const shownCols = cols.slice(0, 8);
  const moreCols = cols.length - shownCols.length;
  const MAX_ROWS = 50;
  const shownRows = rows.slice(0, MAX_ROWS);
  const moreRows = rows.length - shownRows.length;

  if (shownCols.length === 0) {
    // array of objects but no discernible keys — fall back to chips
    return <ScalarChips items={rows.map((r) => JSON.stringify(r))} />;
  }

  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50 text-left">
            {shownCols.map((c) => (
              <th key={c} className="whitespace-nowrap border-b border-slate-200 px-2 py-1 font-semibold text-slate-600">
                {humanize(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownRows.map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50/40">
              {shownCols.map((c) => (
                <td key={c} className="border-b border-slate-100 px-2 py-1 align-top text-slate-700 break-words">
                  {formatCell(r?.[c], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(moreRows > 0 || moreCols > 0) && (
        <div className="bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
          {moreRows > 0 ? `+${moreRows} more row${moreRows === 1 ? '' : 's'}` : ''}
          {moreRows > 0 && moreCols > 0 ? ' · ' : ''}
          {moreCols > 0 ? `+${moreCols} more column${moreCols === 1 ? '' : 's'}` : ''}
        </div>
      )}
    </div>
  );
}

function ScalarChips({ items }: { items: any[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
          {String(it)}
        </span>
      ))}
    </div>
  );
}

function isEmptyVal(v: any): boolean {
  return v === null || v === undefined || v === '' || v === 'null'
    || (Array.isArray(v) && v.length === 0);
}
// A value that must NOT be squeezed into a single grid cell — an array of
// objects (→ its own list/table) or a nested object (→ its own key-value block).
function isComplexVal(v: any): boolean {
  return (Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object'))
    || (v !== null && typeof v === 'object' && !Array.isArray(v));
}

// A short array of objects (DIMMs, disks, NICs…) → one readable mini-card each,
// so it wraps down the page instead of forcing a wide, side-scrolling table.
function ObjectList({ rows }: { rows: any[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="rounded border border-slate-200 bg-slate-50/50 p-2">
          <KeyValueGrid obj={r} />
        </div>
      ))}
    </div>
  );
}

function KeyValueGrid({ obj }: { obj: Record<string, any> }) {
  const entries = Object.entries(obj).filter(([, v]) => !isEmptyVal(v));
  if (entries.length === 0) return <div className="text-xs text-slate-400">None</div>;
  const scalars = entries.filter(([, v]) => !isComplexVal(v));
  const complex = entries.filter(([, v]) => isComplexVal(v));
  return (
    <div className="flex flex-col gap-2.5">
      {scalars.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {scalars.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{humanize(k)}</div>
              <div className="break-words text-xs text-slate-800">{formatCell(v, k)}</div>
            </div>
          ))}
        </div>
      )}
      {complex.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{humanize(k)}</div>
          <SectionData data={v} />
        </div>
      ))}
    </div>
  );
}

function SectionData({ data }: { data: any }) {
  if (data === null || data === undefined) return null;

  if (Array.isArray(data)) {
    if (data.length === 0) return <div className="text-xs text-slate-400">None</div>;
    const objish = data.some((x) => x !== null && typeof x === 'object' && !Array.isArray(x));
    if (!objish) return <ScalarChips items={data} />;
    // Few rows → a stacked mini-card list (readable, wraps, no side-scroll).
    // Many rows → the compact table with internal horizontal scroll.
    return data.length <= 6 ? <ObjectList rows={data} /> : <ObjectTable rows={data} />;
  }

  if (typeof data === 'object') {
    // Some collectors wrap a list as { items: [...], count: N } (e.g. Cisco).
    // Render the items as a table/chips and note the count, instead of showing
    // a raw "items / count" key-value grid.
    if (Array.isArray((data as any).items)) {
      const items = (data as any).items as any[];
      const count = (data as any).count;
      return (
        <div>
          <SectionData data={items} />
          {typeof count === 'number' && count > items.length && (
            <div className="mt-1 text-[11px] text-slate-400">Showing {items.length} of {count}</div>
          )}
        </div>
      );
    }
    return <KeyValueGrid obj={data} />;
  }

  // scalar
  return <div className="text-sm text-slate-800">{formatCell(data)}</div>;
}

function Section({ name, section }: { name: string; section: any }) {
  const status: string = section?.status || 'unavailable';
  const data = section?.data;
  const note: string | undefined = section?.note;
  const hasData =
    data !== null && data !== undefined &&
    !(Array.isArray(data) && data.length === 0);
  // Long tables (services, users, groups, NICs…) start collapsed so the card
  // stays compact; the key summary sections (cpu/memory/os/security) open.
  const isLongList = Array.isArray(data) && data.length > 6;

  return (
    <details open={status === 'discovered' && hasData && !isLongList}
      className="group mb-2 break-inside-avoid rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{humanize(name)}</span>
          <StatusBadge status={status} note={note} />
        </span>
        <span className="text-[11px] text-slate-400 transition group-open:rotate-90">▸</span>
      </summary>
      <div className="border-t border-slate-100 px-3 py-2">
        {hasData ? (
          <SectionData data={data} />
        ) : (
          <div className="text-xs text-slate-500">
            {note || (status === 'permission_denied' ? 'Permission denied.' : 'No data collected.')}
          </div>
        )}
        {note && status !== 'discovered' && hasData && (
          <div className="mt-1 text-[11px] text-slate-400">{note}</div>
        )}
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ *
 * Header (flat scalars)
 * ------------------------------------------------------------------ */
function HeaderScalar({ label, value }: { label: string; value: any }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="break-words text-sm text-slate-800">{formatCell(value, label)}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ordering: known section keys per kind first (in order), then the
 * rest alphabetically.
 * ------------------------------------------------------------------ */
function orderSections(kind: string, keys: string[]): string[] {
  const order = SECTION_ORDER[kind] || [];
  const known: string[] = [];
  const remaining = new Set(keys);
  for (const k of order) {
    if (remaining.has(k)) {
      known.push(k);
      remaining.delete(k);
    }
  }
  const rest = Array.from(remaining).sort((a, b) => a.localeCompare(b));
  return [...known, ...rest];
}

// Internal discovery metadata / sections that duplicate the main asset cards
// (identity ≈ the Network & Platform + Hardware cards) — hidden from the deep
// card to cut noise and the "repeated fields" the operator flagged.
const HIDDEN_SECTIONS = new Set(['fingerprint', 'discovery_classification', 'identity']);

// Server deep sections grouped by domain so the card reads as structured
// clusters instead of one long list. Keys not in any group fall to "Other".
const SERVER_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Hardware', keys: ['cpu', 'memory', 'gpu', 'firmware', 'storage', 'lvm', 'raid'] },
  { title: 'Network', keys: ['network', 'dns'] },
  { title: 'Security', keys: ['defender', 'firewall', 'bitlocker', 'selinux', 'apparmor', 'sshd'] },
  { title: 'Accounts & access', keys: ['local_users', 'local_groups', 'users', 'sudoers'] },
  { title: 'System', keys: ['os', 'services', 'scheduled_tasks', 'windows_update', 'sec_updates', 'shares', 'virt', 'docker', 'podman', 'collection_status'] },
];

function SectionMasonry({ keys, props }: { keys: string[]; props: any }) {
  return (
    <div className="gap-3 [column-fill:_balance] sm:columns-2 xl:columns-3">
      {keys.map((k) => <Section key={k} name={k} section={props[k]} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
export function PlatformDetails({ kind, props }: { kind: string; props: any }) {
  if (!props || typeof props !== 'object') {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        No platform details collected yet — reconnect / scan this asset to populate them.
      </div>
    );
  }

  const scalarKeys: string[] = [];
  const sectionKeys: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (HIDDEN_SECTIONS.has(k)) continue;   // internal metadata / duplicate of the main cards
    if (isSection(v)) {
      sectionKeys.push(k);
    } else if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) {
      scalarKeys.push(k);
    }
  }

  const visibleSectionKeys = sectionKeys.filter((k) => !HIDDEN_SECTIONS.has(k));
  const orderedSections = orderSections(kind, visibleSectionKeys);

  // Server → grouped by domain (Hardware / Network / Security / …). Other kinds →
  // a single masonry, since their section sets are small and already ordered.
  let grouped: { title: string; keys: string[] }[] = [];
  if (kind === 'server') {
    const remaining = new Set(orderedSections);
    grouped = SERVER_GROUPS
      .map((g) => ({ title: g.title, keys: g.keys.filter((k) => remaining.has(k)) }))
      .filter((g) => g.keys.length > 0);
    grouped.forEach((g) => g.keys.forEach((k) => remaining.delete(k)));
    if (remaining.size > 0) grouped.push({ title: 'Other', keys: Array.from(remaining) });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header: flat identity / summary scalars */}
      {scalarKeys.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {scalarKeys.map((k) => (
            <HeaderScalar key={k} label={humanize(k)} value={(props as any)[k]} />
          ))}
        </div>
      )}

      {/* Sections — grouped (server) or one masonry (other kinds). break-inside-
          avoid on each Section keeps a card whole within a column. */}
      {orderedSections.length > 0 && (
        kind === 'server' ? (
          <div className="flex flex-col gap-4">
            {grouped.map((g) => (
              <div key={g.title}>
                <div className="mb-2 border-b border-slate-100 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {g.title}
                </div>
                <SectionMasonry keys={g.keys} props={props} />
              </div>
            ))}
          </div>
        ) : (
          <SectionMasonry keys={orderedSections} props={props} />
        )
      )}

      {scalarKeys.length === 0 && orderedSections.length === 0 && (
        <div className="text-xs text-slate-500">No platform properties to display.</div>
      )}
    </div>
  );
}
