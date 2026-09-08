/*
 * Maps the live asset-detail API payload into the exact data shape the delivered
 * AssetOverview design consumes — for EVERY asset kind (Windows/Linux host,
 * database, network device, cloud account, cluster, directory). The design
 * component is used verbatim; all per-kind adaptation happens here, so each kind
 * renders in the same clean, structured layout with its OWN fields.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { registrableDomain } from '@/lib/domains';


// Outside-only host: born from EASM and never logged into. Checking
// last_seen_source === 'external' alone is WRONG for the hide-gates below —
// a Nessus sync bumps last_seen_source to 'nessus' and the inside-only
// Hardware/AV/Software cards leak back onto a host we have never been inside
// (caught live 24 Aug on liztek.ca). origin_source is stamped once at birth
// and discovery_state stays "unmanaged" until a credential actually profiles
// the box — so this stays true across any number of scanner syncs, and
// correctly flips false the day the host gets a real login.
const isOutsideOnly = (a: any): boolean =>
  a?.last_seen_source === 'external' ||
  (a?.origin_source === 'easm' && (a?.discovery_state ?? 'unmanaged') === 'unmanaged');

// registrableDomain (apex) is imported from @/lib/domains (full Public Suffix List).

const MONO_HINT = /(serial|sid|part_number|mac|ipv4|ipv6|version|path|key|uuid|gateway|subnet|dns|arn|_id$|^id$)/i;

export function humanize(key: string): string {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtValue(key: string, v: any): string {
  if (v === null || v === undefined || v === '' || v === 'null') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') {
    const u = String(key).match(/_(gb|mb|kb|tb|mhz|ghz)$/i);
    if (u) return `${v.toLocaleString()} ${u[1].toUpperCase()}`;
    if (/percentage|percent/i.test(key)) return `${v}%`;
    if (/uptime_hours/i.test(key)) return `${v} h`;
    return v.toLocaleString();
  }
  if (Array.isArray(v)) {
    const flat = v.filter((x) => x !== null && x !== undefined && x !== '');
    return flat.length ? flat.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : 'None';
  }
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${humanize(k)}: ${x}`).join(' · ');
  return String(v);
}

function labelOf(key: string): string {
  const map: Record<string, string> = {
    clock_mhz: 'Clock', total_gb: 'Total', vram_mb: 'VRAM', capacity_gb: 'Capacity',
    free_gb: 'Free', size_gb: 'Size', speed_mhz: 'Speed', encryption_percentage: 'Encryption',
    uptime_hours: 'Uptime', part_of_domain: 'Part Of Domain', logical_processors: 'Logical Processors',
    account_id: 'Account ID', db_count: 'Databases', node_count: 'Nodes',
  };
  return map[key] || humanize(key);
}

const isEmpty = (v: any) => v === null || v === undefined || v === '' || v === 'null'
  || (Array.isArray(v) && v.length === 0);
const sec = (o: any) => (o && typeof o === 'object' && 'status' in o && 'data' in o ? o : null);
const dataOf = (o: any) => (sec(o) ? o.data : undefined);
const statusOf = (o: any) => (sec(o) ? o.status : 'unavailable');

// object -> Cell items (scalars only), dropping empties.
function toItems(obj: any, opts: { tones?: Record<string, string> } = {}): any[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .filter(([, v]) => !isEmpty(v))
    .filter(([, v]) => !(Array.isArray(v) && v.some((x) => x && typeof x === 'object')))
    .filter(([, v]) => !(v && typeof v === 'object' && !Array.isArray(v)))
    .map(([k, v]) => ({ label: labelOf(k), value: fmtValue(k, v), mono: MONO_HINT.test(k) || undefined, tone: opts.tones?.[k] }));
}

function objList(rows: any[], label?: string) {
  return { type: 'objlist', label, objects: (rows || []).map((r) => toItems(r)) };
}

function genericTable(rows: any[]) {
  const cols: string[] = [];
  for (const r of rows) if (r && typeof r === 'object') for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const c = cols.slice(0, 8);
  return {
    type: 'table', variant: 'generic',
    headers: c.map(labelOf),
    rows: rows.slice(0, 200).map((r) => c.map((k) => fmtValue(k, r?.[k]))),
  };
}

// Turn ANY section's data into design blocks, by shape.
function blocksFor(key: string, data: any): any[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) {
    if (!data.length) return [{ type: 'kv', items: [{ label: humanize(key), value: 'None' }] }];
    const objish = data.some((x) => x && typeof x === 'object');
    if (!objish) return [{ type: 'kv', items: [{ label: humanize(key), value: fmtValue(key, data) }] }];
    return data.length <= 6 ? [objList(data)] : [genericTable(data)];
  }
  if (typeof data === 'object') {
    const scalars: any = {}; const subs: [string, any][] = []; const lists: [string, any][] = [];
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) lists.push([k, v]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) subs.push([k, v]);
      else scalars[k] = v;
    }
    const blocks: any[] = [];
    if (Object.keys(scalars).some((k) => !isEmpty(scalars[k]))) blocks.push({ type: 'kv', items: toItems(scalars) });
    for (const [k, v] of subs) blocks.push({ type: 'sub', label: humanize(k), items: toItems(v) });
    for (const [k, v] of lists) blocks.push(v.length <= 6 ? objList(v, humanize(k)) : { ...genericTable(v), label: humanize(k) });
    return blocks.length ? blocks : [{ type: 'kv', items: [{ label: humanize(key), value: 'None' }] }];
  }
  return [{ type: 'kv', items: [{ label: humanize(key), value: fmtValue(key, data) }] }];
}

// Named enhancements — the polished Windows blocks. Applied by section key, so
// they only fire when that shape exists; other kinds fall through to blocksFor.
function sectionBlocks(key: string, data: any): { blocks?: any[]; sectionExtra?: any } {
  if (key === 'local_users' && Array.isArray(data)) {
    return { blocks: [{ type: 'table', variant: 'users', headers: ['Full Name', 'Name', 'SID', 'Lockout', 'Disabled'],
      rows: data.map((u: any) => [u.full_name || '—', u.name || '—', u.sid || '—', u.lockout ? '✓' : '✗', u.disabled ? '✓' : '✗']) }] };
  }
  if (key === 'local_groups' && Array.isArray(data)) {
    return { blocks: [{ type: 'table', variant: 'groups', headers: ['Group', 'Description'],
      rows: data.map((g: any) => [g.name || '—', g.description || '—']) }] };
  }
  // Windows services (has display_name/start_mode) -> the searchable services card.
  if (key === 'services' && Array.isArray(data) && data.some((s: any) => s && (s.display_name || s.start_mode))) {
    return { sectionExtra: { variant: 'services', note: `${data.length} collected`,
      headers: ['Account', 'Name', 'Path', 'Start Mode', 'State', 'Display Name'],
      rows: data.map((s: any) => [s.account || '—', s.name || '—', s.path || '—', s.start_mode || '—', s.state || '—', s.display_name || '—']),
      blocks: [] } };
  }
  if (key === 'scheduled_tasks' && data && typeof data === 'object' && !Array.isArray(data)) {
    return { blocks: [{ type: 'stat', items: Object.entries(data).map(([k, v]) => ({ label: humanize(k), value: fmtValue(k, v) })) }] };
  }
  if (key === 'memory' && data && typeof data === 'object' && !Array.isArray(data)) {
    const b: any[] = [{ type: 'kv', items: toItems({ total_gb: data.total_gb }) }];
    if (Array.isArray(data.dimms) && data.dimms.length) b.push(objList(data.dimms, 'DIMMs'));
    return { blocks: b };
  }
  if (key === 'storage' && data && typeof data === 'object' && !Array.isArray(data)) {
    const b: any[] = [];
    if (Array.isArray(data.physical_disks) && data.physical_disks.length) b.push(objList(data.physical_disks, 'Physical Disks'));
    if (Array.isArray(data.volumes) && data.volumes.length) b.push(objList(data.volumes, 'Volumes'));
    if (b.length) return { blocks: b };
  }
  if (key === 'firmware' && data && typeof data === 'object' && !Array.isArray(data)) {
    const b: any[] = [];
    if (data.motherboard) b.push({ type: 'sub', label: 'Motherboard', items: toItems(data.motherboard) });
    if (data.bios) b.push({ type: 'sub', label: 'BIOS', items: toItems(data.bios) });
    if (b.length) return { blocks: b };
  }
  return { blocks: blocksFor(key, data) };
}

// Per-kind domain grouping — every kind reads as the same structured tabs.
const KIND_GROUPS: Record<string, { title: string; keys: string[] }[]> = {
  server: [
    { title: 'Hardware', keys: ['cpu', 'memory', 'gpu', 'firmware', 'storage', 'storage_disks', 'storage_mounts', 'lvm', 'raid'] },
    { title: 'Network', keys: ['network', 'net_addr', 'net_link', 'net_route', 'dns'] },
    { title: 'Security', keys: ['security_products', 'defender', 'firewall', 'bitlocker', 'selinux', 'apparmor', 'sshd'] },
    { title: 'Accounts & Access', keys: ['local_users', 'local_groups', 'users', 'sudoers'] },
    { title: 'System', keys: ['os', 'operating_system', 'identity', 'windows_update', 'scheduled_tasks', 'shares', 'services', 'pkg', 'sec_updates', 'virt', 'docker', 'podman'] },
  ],
  // Keys below are the ACTUAL section names each collector emits (postgres /
  // mysql / mssql / oracle share this plan; cisco; aws+azure+digitalocean; k8s; ad).
  database: [
    { title: 'Configuration', keys: ['settings', 'replication', 'high_availability', 'runtime', 'additional', 'instance'] },
    { title: 'Databases', keys: ['databases', 'schemas', 'objects', 'tables', 'storage_engines'] },
    { title: 'Access & Extensions', keys: ['roles', 'users', 'logins', 'security', 'extensions', 'plugins', 'foreign_data_wrappers'] },
    { title: 'Storage & Files', keys: ['storage', 'files', 'tablespaces', 'control_files', 'redo_logs'] },
  ],
  network: [
    { title: 'Device', keys: ['hardware', 'modules', 'environment', 'firmware'] },
    { title: 'Interfaces', keys: ['interfaces', 'interface_status', 'ip_interfaces', 'port_channels'] },
    { title: 'Switching', keys: ['vlans', 'vrfs', 'spanning_tree'] },
    { title: 'Forwarding', keys: ['mac_table', 'arp', 'routing', 'cdp_neighbors'] },
    { title: 'Management', keys: ['ntp', 'snmp', 'raw_show_version'] },
  ],
  cloud: [
    { title: 'Account', keys: ['regions', 'resource_groups', 'projects'] },
    { title: 'Compute', keys: ['ec2', 'virtual_machines', 'instances', 'droplets', 'ecs', 'eks', 'aks_clusters', 'container_instances', 'lambda', 'function_apps', 'app_services'] },
    { title: 'Storage', keys: ['ebs_volumes', 'disks', 'volumes', 'snapshots', 'storage_accounts', 'container_registry', 's3', 'spaces'] },
    { title: 'Databases', keys: ['rds', 'sql_servers', 'managed_databases', 'dynamodb'] },
    { title: 'Network', keys: ['vpcs', 'vnets', 'subnets', 'security_groups', 'nsgs', 'network_interfaces', 'route_tables', 'public_ips', 'reserved_ips', 'load_balancers', 'firewalls'] },
    { title: 'Messaging & Secrets', keys: ['sns', 'sqs', 'key_vaults'] },
  ],
  cluster: [
    { title: 'Cluster', keys: ['nodes', 'namespaces'] },
    { title: 'Workloads', keys: ['deployments', 'replicasets', 'statefulsets', 'daemonsets', 'pods', 'containers', 'jobs', 'cronjobs'] },
    { title: 'Networking', keys: ['services', 'ingress', 'network_policies'] },
    { title: 'Storage', keys: ['persistent_volumes', 'persistent_volume_claims', 'storage_classes'] },
  ],
  identity: [
    { title: 'Topology', keys: ['domain_controllers', 'sites'] },
    { title: 'Structure', keys: ['ous', 'computers'] },
    { title: 'Accounts', keys: ['users', 'groups'] },
  ],
};

// Linux hosts read differently from Windows — curated for how an admin scans a
// box. `identity` (distro/kernel/BIOS) is consumed by the OS & Hardware hero, so
// it's not repeated as a deep section.
const LINUX_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Hardware', keys: ['cpu', 'memory', 'gpu', 'storage', 'storage_disks', 'storage_mounts', 'lvm', 'raid'] },
  { title: 'Network', keys: ['network', 'net_addr', 'net_link', 'net_route', 'dns'] },
  { title: 'Security', keys: ['firewall', 'selinux', 'apparmor', 'ssh_config', 'sshd', 'sudoers'] },
  { title: 'Packages & Services', keys: ['packages', 'pkg', 'security_updates', 'sec_updates', 'services', 'virtualization', 'virt', 'docker', 'podman'] },
  { title: 'Accounts', keys: ['users'] },
];

const HIDDEN = new Set(['fingerprint', 'discovery_classification']);
const isLinux = (asset: any) => (asset?.os_family || '').toLowerCase().startsWith('linux');

/** platform_properties -> the design's `deep` groups, grouped per kind. */
function buildDeep(pp: any, kind: string, linux = false): { groups: any[]; notes: { denied: string[]; absent: string[] } } {
  if (!pp || typeof pp !== 'object') return { groups: [], notes: { denied: [], absent: [] } };
  // On hosts, `identity` is already surfaced by the hero cards (Windows: the
  // Network/Hardware cards; Linux: the OS & Hardware card), so don't repeat it.
  const hide = new Set(HIDDEN);
  if (kind === 'server') hide.add('identity');
  const sectionKeys = Object.keys(pp).filter((k) => sec(pp[k]) && !hide.has(k));

  // Does a section carry real, showable content?
  const contentful = (key: string): boolean => {
    const enh = sectionBlocks(key, dataOf(pp[key]));
    if (statusOf(pp[key]) !== 'discovered') return false;
    return !!(enh.sectionExtra && Array.isArray(enh.sectionExtra.rows) && enh.sectionExtra.rows.length)
      || (enh.blocks || []).some((b: any) => (b.items && b.items.length) || (b.objects && b.objects.length) || (b.rows && b.rows.length));
  };
  // ONLY sections with real data become cards. Empty / blocked / absent ones are
  // NOT rendered as blank cards — they're summarised in one honest callout so the
  // page is dense with facts, not a field of empties.
  const denied: string[] = []; const absent: string[] = [];
  for (const k of sectionKeys) {
    if (contentful(k)) continue;
    const st = statusOf(pp[k]);
    if (st === 'permission_denied') denied.push(humanize(k));
    else absent.push(humanize(k));   // not_supported / not_applicable / unavailable / empty
  }

  const build = (key: string) => {
    const enh = sectionBlocks(key, dataOf(pp[key]));
    return { title: humanize(key === 'os' ? 'operating_system' : key), status: statusOf(pp[key]), ...enh, ...(enh.sectionExtra || {}) };
  };
  const groups: { key: string; label: string; sections: any[] }[] = [];
  const plan = linux ? LINUX_GROUPS : (KIND_GROUPS[kind] || KIND_GROUPS.server);
  const used = new Set<string>();
  for (const g of plan) {
    const present = g.keys.filter((k) => sectionKeys.includes(k) && contentful(k));
    g.keys.forEach((k) => used.add(k));   // reserve, so a blocked section isn't double-counted in Other
    if (present.length) groups.push({ key: g.title.toLowerCase().replace(/[^a-z]+/g, '') || g.title, label: g.title, sections: present.map(build) });
  }
  const rest = sectionKeys.filter((k) => !used.has(k) && contentful(k));
  if (rest.length) groups.push({ key: 'other', label: 'Other', sections: rest.map(build) });
  return { groups, notes: { denied, absent } };
}

// Machine (provenance) summary cards — kind-aware. Hosts get the rich hardware
// card; typed platforms get a Network & Platform card plus a kind summary built
// from their own flat identity scalars.
function buildMachineCards(asset: any, pp: any, kind: string, linux = false): any[] {
  const dash = (v: any) => (isEmpty(v) ? '—' : v);
  const date = (s: any) => (s ? String(s).slice(0, 10) : '—');
  const os = dataOf(pp.os);
  const cpuD = dataOf(pp.cpu) || {};
  const gpuD = dataOf(pp.gpu);
  const gpu1 = Array.isArray(gpuD) ? gpuD[0] : gpuD;
  const idn = dataOf(pp.identity) || {};
  const pkg = dataOf(pp.packages) || dataOf(pp.pkg) || {};
  // External (EASM) assets were reached from the public internet, not swept with
  // an agentless credential — one label reused on every provenance card below.
  const scanNote = isOutsideOnly(asset) ? 'Outside-in probe' : 'Agentless scan';

  // ── Application (a piece of software promoted to its own child asset) ──
  // It has NO hardware/OS of its own — those belong to the host it runs on. Show
  // its real facts (the app_attributes the profiler collected) + a "Runs On"
  // pointer, instead of the wrong "OS: PostgreSQL 18" / blank-hardware host cards.
  if (asset?.asset_type === 'application') {
    const app = asset.app_attributes_json || {};
    const running = /run|active|listen/i.test(String(app.service_state || ''));
    return [
      {
        title: 'Application', note: scanNote,
        fields: [
          { label: 'Product', value: dash(asset.name) },
          { label: 'Version', value: dash(asset.os_version) },
          { label: 'Listen Port', value: dash(app.listen_port), mono: true },
          { label: 'Service Name', value: dash(app.service_name), mono: true },
          { label: 'Service State', value: dash(app.service_state), tone: app.service_state ? (running ? 'ok' : 'warn') : undefined },
          { label: 'Service Account', value: dash(app.service_account) },
          { label: 'Install Path', value: dash(app.install_path), mono: true },
          { label: 'Benchmark Key', value: dash(asset.os_normalized), mono: true },
        ],
      },
      {
        title: 'Runs On', note: 'Parent host',
        fields: [
          { label: 'Host', value: dash(asset.host_name || (asset.parent_asset_id ? `Asset #${asset.parent_asset_id}` : '—')) },
          { label: 'IP Address', value: dash(asset.ip_address), mono: true },
          { label: 'Network Segment', value: dash(asset.network_segment), mono: true },
          { label: 'Host OS', value: dash(asset.os_family) },
          { label: 'Scan Source', value: dash(asset.last_seen_source) },
          { label: 'Record Source', value: dash(asset.source_system || 'discovery') },
          { label: 'First Seen', value: date(asset.first_seen_at || asset.created_at) },
          { label: 'Last Seen', value: date(asset.last_seen_at) },
        ],
      },
    ];
  }

  const netPlatform = {
    title: 'Network & Platform', note: scanNote,
    fields: [
      { label: 'IP Address', value: dash(asset?.ip_address), mono: true },
      { label: 'Network Segment', value: dash(asset?.network_segment), mono: true },
      { label: 'Hostname', value: dash(asset?.host_name) },
      { label: 'FQDN', value: dash(asset?.fqdn) },
      { label: 'MAC Address', value: dash(asset?.primary_mac), mono: true },
      { label: 'Internet Exposed', value: asset?.internet_facing ? 'Yes' : 'No', tone: asset?.internet_facing ? 'bad' : 'ok' },
    ],
  };

  // ── External (EASM) host: reached from the public internet, never logged into ──
  // Cards are driven by what was ACTUALLY collected. An outside-in probe can only
  // see the public face (IP, DNS name, HTTP, TLS) — it can never read vCPU, RAM,
  // disk, MAC, serial, OS build, AV/EDR or installed packages. Rendering the
  // inside-only Hardware card for these hosts produced a wall of "Not set" and a
  // misleading red "Antivirus: None detected" (caught live 23 Aug — that reads as a
  // finding, when it really means "no way to see inside"). So: only the cards whose
  // data can exist. The Internet-exposure card (real HTTP/TLS facts) is added by
  // buildOverviewData after this returns.
  if (isOutsideOnly(asset)) {
    const sourceName = asset?.discovery_source || 'Certificate Transparency';
    return [{
      title: 'Public identity', note: 'Outside-in probe',
      fields: [
        { label: 'FQDN', value: dash(asset?.fqdn || asset?.host_name) },
        ...(Array.isArray(asset?.dns_aliases) && asset.dns_aliases.length
          ? [{ label: 'Also Known As', value: asset.dns_aliases.join(', '), mono: true }]
          : []),
        { label: 'Resolves To', value: dash(asset?.ip_address), mono: true },
        { label: 'Internet Exposed', value: asset?.internet_facing ? 'Yes' : 'No', tone: asset?.internet_facing ? 'bad' : 'ok' },
        { label: 'Found Via', value: sourceName },
        { label: 'First Seen', value: date(asset?.first_seen_at || asset?.created_at) },
        { label: 'Last Seen', value: date(asset?.last_seen_at) },
        { label: 'Inside View', value: 'Not available — no login (external host). Scan with Nessus to find weak spots.', tone: 'muted' },
      ],
    }];
  }

  // ── Linux host: two BALANCED hero cards curated for a Linux admin ──
  // Left = network + OS identity; right = hardware + telemetry. Field counts are
  // kept close so neither card stretches with a large empty gap.
  if (kind === 'server' && linux) {
    return [
      {
        ...netPlatform,
        fields: [...netPlatform.fields,
          { label: 'Distribution', value: dash(idn.distribution || asset?.os_version) },
          { label: 'Kernel', value: dash(idn.kernel), mono: true },
          { label: 'Architecture', value: dash(idn.architecture || cpuD.architecture) },
          { label: 'Normalised OS Key', value: dash(asset?.os_normalized), mono: true },
        ],
      },
      {
        title: 'Hardware & Telemetry', note: scanNote,
        tiles: [
          { num: asset?.cpu_cores ?? '—', label: 'vCPU' },
          { num: asset?.memory_gb ?? '—', label: 'GB RAM' },
          { num: asset?.storage_gb ?? '—', label: 'GB Disk' },
        ],
        fields: [
          { label: 'CPU', value: dash(cpuD.model) },
          { label: 'CPU Vendor', value: dash(cpuD.vendor) },
          { label: 'Manufacturer', value: dash(asset?.manufacturer || idn.manufacturer) },
          { label: 'Model', value: dash(asset?.model || idn.model) },
          { label: 'Serial Number', value: dash(asset?.serial_number || idn.serial), mono: true },
          { label: 'BIOS', value: dash(idn.bios_version ? `${idn.bios_vendor || ''} ${idn.bios_version}`.trim() : '—'), mono: true },
          { label: 'Uptime', value: idn.uptime_hours != null ? `${idn.uptime_hours} h` : '—' },
          { label: 'Boot Time', value: dash(idn.boot_time) },
          { label: 'Package Manager', value: (pkg.package_manager || pkg.manager) ? `${pkg.package_manager || pkg.manager}${(pkg.installed_count ?? pkg.count) != null ? ` · ${(pkg.installed_count ?? pkg.count).toLocaleString()} pkgs` : ''}` : '—' },
          { label: 'Scan Source', value: dash(asset?.last_seen_source) },
          { label: 'First Seen', value: date(asset?.first_seen_at || asset?.created_at) },
          { label: 'Last Seen', value: date(asset?.last_seen_at) },
        ],
      },
    ];
  }

  if (kind === 'server') {
    return [
      { ...netPlatform, fields: [...netPlatform.fields,
        { label: 'Operating System', value: dash(asset?.os_version || (os && os.edition)) },
        { label: 'Manufacturer', value: dash(asset?.manufacturer) },
        { label: 'Model', value: dash(asset?.model) },
        { label: 'Serial Number', value: dash(asset?.serial_number), mono: true },
      ] },
      {
        title: 'Hardware & Telemetry', note: scanNote,
        tiles: [
          { num: asset?.cpu_cores ?? '—', label: 'vCPU' },
          { num: asset?.memory_gb ?? '—', label: 'GB RAM' },
          { num: asset?.storage_gb ?? '—', label: 'GB Disk' },
        ],
        fields: [
          { label: 'CPU', value: dash(cpuD && cpuD.model) },
          { label: 'GPU', value: dash(gpu1 && gpu1.model) },
          { label: 'OS Family', value: dash(asset?.os_family) },
          { label: 'OS Edition', value: dash(asset?.os_edition) },
          { label: 'OS Build', value: dash(asset?.os_build) },
          { label: 'Normalised OS Key', value: dash(asset?.os_normalized), mono: true },
          { label: 'Scan Source', value: dash(asset?.last_seen_source) },
          { label: 'Record Source', value: dash(asset?.source_system || 'manual') },
          { label: 'Agent Version', value: dash(asset?.agent_version) },
          { label: 'First Seen', value: date(asset?.first_seen_at || asset?.created_at) },
          { label: 'Last Seen', value: date(asset?.last_seen_at) },
        ],
      },
    ];
  }

  // Typed platforms — a kind summary from the top-level flat scalars PLUS the
  // headline counts an operator wants first (how many databases / interfaces /
  // regions / pods / users…). Counts come from the section arrays.
  const flat = Object.entries(pp)
    .filter(([, v]) => !sec(v) && !isEmpty(v) && typeof v !== 'object')
    .map(([k, v]) => ({ label: labelOf(k), value: fmtValue(k, v), mono: MONO_HINT.test(k) || undefined }));
  const COUNT_KEYS: Record<string, string[]> = {
    database: ['databases', 'schemas', 'roles', 'users', 'extensions', 'tablespaces'],
    network: ['interfaces', 'vlans', 'routing', 'mac_table', 'cdp_neighbors'],
    cloud: ['regions', 'ec2', 'virtual_machines', 'droplets', 's3', 'storage_accounts', 'rds', 'sql_servers', 'managed_databases', 'vpcs'],
    cluster: ['nodes', 'namespaces', 'pods', 'deployments', 'services', 'persistent_volumes'],
    identity: ['domain_controllers', 'sites', 'ous', 'computers', 'users', 'groups'],
  };
  const counts = (COUNT_KEYS[kind] || []).map((k) => {
    const d = dataOf(pp[k]);
    const n = Array.isArray(d) ? d.length
      : (d && Array.isArray(d.items) ? d.items.length : (d && typeof d.count === 'number' ? d.count : null));
    return n != null ? { label: humanize(k), value: n.toLocaleString() } : null;
  }).filter(Boolean) as any[];
  const title: Record<string, string> = { database: 'Database Engine', network: 'Network Device', cloud: 'Cloud Account', cluster: 'Cluster', identity: 'Directory' };
  const summary = { title: title[kind] || 'Platform', note: scanNote,
    fields: [...flat, ...counts].length ? [...flat, ...counts] : [{ label: 'Details', value: 'See sections below' }] };
  // Cloud accounts have no LAN identity — skip the IP/MAC card entirely.
  return kind === 'cloud' ? [summary] : [netPlatform, summary];
}


// ── Layer 2: AI-planned cards ─────────────────────────────────────────────────
// The plan carries ONLY headings + card grouping per field KEY (the model never
// saw a value). This walks the asset with the SAME key paths the backend
// enumerated (services/asset_layout_ai.collect_field_keys) and places the REAL
// collected value under the planned heading. Any key the plan names that the
// asset no longer has is simply skipped; any card that ends up empty is dropped.
// Returns null if nothing could be placed, so the caller falls back to Layer 1.
function readPlannedValue(asset: any, pp: any, key: string): any {
  const dot = key.indexOf('.');
  if (dot < 0) return pp?.[key];
  const head = key.slice(0, dot), tail = key.slice(dot + 1);
  if (head === 'external_probe') return pp?.external_probe?.[tail];
  if (head === 'app') return asset?.app_attributes_json?.[tail];
  const s = pp?.[head];
  return sec(s) ? s.data?.[tail] : undefined;
}

function buildPlannedCards(asset: any, pp: any, plan: NonNullable<OverviewOpts['plan']>, note: string): any[] | null {
  if (!plan || !Array.isArray(plan.fields) || !Array.isArray(plan.cards)) return null;
  const byCard: Record<string, any[]> = {};
  for (const f of plan.fields) {
    const raw = readPlannedValue(asset, pp, f.key);
    if (isEmpty(raw) || (typeof raw === 'object' && !Array.isArray(raw))) continue;
    const leaf = f.key.slice(f.key.lastIndexOf('.') + 1);
    (byCard[f.card] ||= []).push({
      label: f.heading,                       // the AI heading
      value: fmtValue(leaf, raw),             // the REAL value, formatted only for units/booleans
      mono: MONO_HINT.test(leaf) || undefined,
    });
  }
  const cards = [...plan.cards]
    .sort((a, b) => a.order - b.order)
    .filter((c) => (byCard[c.name] || []).length > 0)
    .map((c) => ({ title: c.name, note, fields: byCard[c.name], full: c.size === 'full' }));
  return cards.length ? cards : null;
}

// ── External (EASM) helpers ───────────────────────────────────────────────────
// Everything below is used ONLY when isOutsideOnly(asset) is true. It reads the
// FLAT platform_properties.external_probe dict written by the backend
// external_probe.probe_asset (see backend .../services/external_probe.py) — never
// fabricating a field the probe didn't collect.
const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-09-24T..." -> "24 Sep" (deterministic; no Date parsing / locale drift).
function fmtDay(iso: any): string {
  const p = String(iso ?? '').slice(0, 10).split('-');
  return p.length === 3 && _MON[+p[1] - 1] ? `${+p[2]} ${_MON[+p[1] - 1]}` : String(iso ?? '').slice(0, 10);
}
// Services an outside-in probe can actually attest to: HTTPS if 443 answered TLS,
// plain HTTP only when the host is live over http with no HTTPS, SMTP if it has MX.
function extExposedServices(pr: any): string[] {
  if (!pr) return [];
  const s: string[] = [];
  if (pr.https_available) s.push('HTTPS');
  else if (pr.live && pr.scheme === 'http') s.push('HTTP');
  if (Array.isArray(pr.dns_mx) && pr.dns_mx.length) s.push('SMTP');
  return s;
}

// Not-collected marker for a probe field an outside-in scan structurally CANNOT
// read (WHOIS, DNSSEC, MTA-STS, ASN, cert key type, reverse DNS…). Deliberately
// NOT the bare '—' the Cell turns into "Not set" — that reads as a field someone
// forgot to fill in, whereas this reads as "the probe can't see this from outside".
const NC = '— · not collected';
const ncItem = (label: string) => ({ label, value: NC, tone: 'muted' });
// A section kept in the shell (so the layout matches the mock) whose data is
// entirely absent — one honest line instead of fabricated rows.
const noteSec = (title: string, text: string) => ({ title, status: 'not collected', blocks: [{ type: 'note', text }] });

// platform_properties.external_probe -> the design's `deep` groups. The FULL
// mock shell is always rendered (Domain & DNS, Web/TLS & Exposure, Infrastructure,
// Discovery & evidence) so an external asset reads the same everywhere; each field
// is a REAL probe/asset value where one exists, else an honest "not collected".
// Nothing is fabricated (no fake TTL, ASN, WHOIS dates, ports, key type).
function buildExternalDeep(asset: any, pr: any): any[] {
  const groups: any[] = [];
  const aliases = Array.isArray(asset?.dns_aliases) ? asset.dns_aliases.filter(Boolean) : [];
  const live = !!pr?.live;
  const probed = !!pr;   // an external_probe block was written for this host at all
  const dnsProbed = !!(pr && (pr.dns_a || pr.dns_mx || pr.dns_ns || pr.caa || pr.spf || pr.dmarc || pr.dkim));
  const fqdn = asset?.fqdn || asset?.host_name || pr?.fqdn || '';
  const apexOf = registrableDomain(fqdn);
  // A leaf subdomain (www.liztek.ca) vs the apex (liztek.ca). Domain-level facts
  // — WHOIS, nameservers, the subdomain roll-up — belong to the apex only.
  const isSubdomain = !!(apexOf && fqdn && fqdn.toLowerCase() !== apexOf.toLowerCase());
  const date10 = (s: any) => (s ? String(s).slice(0, 10) : '—');
  const kvOrNC = (label: string, v: any, mono?: boolean) => (v ? { label, value: String(v), mono } : ncItem(label));

  // ── Domain & DNS Telemetry ─────────────────────────────────────────────────
  const dnsSecs: any[] = [];

  // Registration & WHOIS — WHOIS is not probed outside-in; Nameservers (dns_ns)
  // is the one real field. The rest are kept so the shell matches the mock, honest.
  const ns = (Array.isArray(pr?.whois_nameservers) && pr.whois_nameservers.length ? pr.whois_nameservers : (Array.isArray(pr?.dns_ns) ? pr.dns_ns : [])).filter(Boolean);
  const wStatus = Array.isArray(pr?.whois_status) ? pr.whois_status.filter(Boolean) : [];
  const locked = wStatus.some((x: string) => /transfer\s*prohibited/i.test(x));
  const whoisProbed = !!(pr?.whois_registrar || pr?.whois_created || pr?.whois_expires || ns.length);
  if (isSubdomain) {
    // A subdomain isn't separately registered — registration lives on the apex.
    dnsSecs.push(noteSec('Registration & WHOIS', `Domain registration, nameservers & WHOIS are tracked on the apex domain ${apexOf}.`));
  } else {
    dnsSecs.push({ title: 'Registration & WHOIS', status: whoisProbed ? 'discovered' : 'not collected', blocks: [{ type: 'kv', items: [
      kvOrNC('Registrar', pr?.whois_registrar),
      ncItem('Registry'),
      kvOrNC('Created', pr?.whois_created ? date10(pr.whois_created) : null),
      kvOrNC('Expires', pr?.whois_expires ? date10(pr.whois_expires) : null),
      { label: 'Nameservers', value: ns.length ? ns.join(', ') : NC, mono: ns.length ? true : undefined, tone: ns.length ? undefined : 'muted' },
      kvOrNC('Status', wStatus.length ? wStatus.join(' · ') : null),
      (pr?.dnssec ? { label: 'DNSSEC', value: pr.dnssec, tone: pr.dnssec === 'signed' ? 'ok' : 'warn' } : ncItem('DNSSEC')),
      (pr?.whois_status ? { label: 'Transfer lock', value: locked ? 'Locked' : 'Unlocked', tone: locked ? 'ok' : 'warn' } : ncItem('Transfer lock')),
    ] }] });
  }

  // DNS records (A / MX / CAA / TXT-spf). Name = apex fqdn (real); TTL is not
  // returned by the probe, so it renders '—'.
  const dnsRows: any[] = [];
  if (Array.isArray(pr?.dns_records) && pr.dns_records.length) {
    pr.dns_records.forEach((r: any) => dnsRows.push([r?.type || '—', r?.name || fqdn || '—', String(r?.value ?? '—'), r?.ttl != null ? String(r.ttl) : '—']));
  } else {
    const pushRecs = (type: string, vals: any) =>
      (Array.isArray(vals) ? vals : []).filter(Boolean).forEach((v: any) => dnsRows.push([type, fqdn || '—', String(v), '—']));
    pushRecs('A', pr?.dns_a); pushRecs('MX', pr?.dns_mx); pushRecs('CAA', pr?.caa);
    if (pr?.spf) dnsRows.push(['TXT', fqdn || '—', String(pr.spf), '—']);
  }
  dnsSecs.push(dnsRows.length
    ? { title: 'DNS records', status: 'discovered', blocks: [{ type: 'table', headers: ['Type', 'Name', 'Value', 'TTL'], rows: dnsRows }] }
    : noteSec('DNS records', dnsProbed ? 'No A / MX / CAA / TXT records resolved for this host.' : 'Not collected by the outside-in probe — run Rescan domain to resolve DNS records.'));

  // Email security — SPF / DMARC / DKIM real (present/missing when probed);
  // DNSSEC + MTA-STS are not probed.
  const yn = (v: any) => (v ? { value: '✓ present', tone: 'ok' } : (probed ? { value: '✗ missing', tone: 'bad' } : { value: NC, tone: 'muted' }));
  dnsSecs.push({ title: 'Email security', status: probed ? 'discovered' : 'not collected', blocks: [{ type: 'kv', items: [
    { label: 'SPF', ...yn(pr?.spf) }, { label: 'DMARC', ...yn(pr?.dmarc) }, { label: 'DKIM', ...yn(pr?.dkim) },
    (pr?.dnssec ? { label: 'DNSSEC', value: pr.dnssec, tone: pr.dnssec === 'signed' ? 'ok' : 'warn' } : ncItem('DNSSEC')),
    (pr?.mta_sts != null ? { label: 'MTA-STS', value: pr.mta_sts ? `✓ ${pr.mta_sts_mode || 'present'}` : '✗ absent', tone: pr.mta_sts ? 'ok' : 'warn' } : ncItem('MTA-STS')),
  ] }] });

  // Subdomains — APEX ONLY (a leaf subdomain has none). Source order: the probe's
  // crt.sh list, else the apex certificate SANs (real) + dns_aliases.
  if (!isSubdomain) {
    const sans = (Array.isArray(pr?.tls_sans) ? pr.tls_sans : []).filter((h: any) => typeof h === 'string');
    const sanSubs = sans.filter((h: string) => h.toLowerCase() !== fqdn.toLowerCase() && h.toLowerCase().endsWith('.' + (apexOf || fqdn).toLowerCase()));
    const subRows = (Array.isArray(pr?.subdomains) && pr.subdomains.length
      ? pr.subdomains.map((sd: any) => [sd?.host || '—', (Array.isArray(sd?.resolves_to) && sd.resolves_to.length ? sd.resolves_to.join(', ') : '—'), '—', '—', sd?.first_seen ? date10(sd.first_seen) : '—', '—'])
      : Array.from(new Set([...aliases, ...sanSubs].filter(Boolean))).sort().map((a: string) => [a, '—', '—', '—', '—', '—']));
    dnsSecs.push(subRows.length
      ? { title: 'Subdomains', status: 'discovered', blocks: [
          { type: 'table', headers: ['Host', 'Resolves to', 'Purpose', 'Ports', 'First seen', 'Last seen'], rows: subRows },
          { type: 'note', text: 'From the apex certificate SANs + passive DNS/CT. Each is also tracked as its own asset — expand the apex row in the register to open them.' },
        ] }
      : noteSec('Subdomains', 'No subdomains discovered by the outside-in probe.'));
  }

  groups.push({ key: 'dns', label: 'Domain & DNS Telemetry', pill: 'Domain & DNS', sub: 'Registration, DNS records, email security & subdomains · EASM domain scan', sections: dnsSecs });

  // ── Web, TLS & Exposure Telemetry ──────────────────────────────────────────
  const webSecs: any[] = [];

  // TLS certificates — Subject / SANs / Issuer / Valid-to / Grade are real; Key
  // type/size is not read by the probe.
  const d2e = pr?.tls_days_to_expiry;
  if (pr?.tls_not_after) {
    const validTo = `${fmtDay(pr.tls_not_after)}${typeof d2e === 'number' ? ` · ${d2e}d` : ''}`;
    const sans = Array.isArray(pr?.tls_sans) && pr.tls_sans.length ? pr.tls_sans.join(', ') : '—';
    webSecs.push({ title: 'TLS certificates', status: 'discovered', blocks: [{ type: 'table',
      headers: ['Subject', 'SANs', 'Issuer', 'Key', 'Valid to', 'Grade'],
      rows: [[pr.tls_subject_cn || fqdn || '—', sans, pr.tls_issuer || '—', pr?.tls_key || '—', validTo, pr?.health?.grade || '—']] }] });
  } else {
    webSecs.push(noteSec('TLS certificates', pr?.tls_error
      ? `No certificate retrieved on 443 — ${pr.tls_error}`
      : 'Not collected by the outside-in probe — no TLS certificate retrieved.'));
  }

  // Exposed services — asserted ONLY from real facts (TLS answered on 443, HTTP
  // responded on 80, MX present). This is not a full port scan; nothing invented.
  const svcRows: any[] = [];
  if (pr?.https_available) svcRows.push(['443', 'HTTPS', 'TLS handshake succeeded']);
  if (live && pr?.scheme === 'http' && !pr?.https_available) svcRows.push(['80', 'HTTP', `HTTP ${pr?.status_code ?? ''}`.trim()]);
  if (Array.isArray(pr?.dns_mx) && pr.dns_mx.length) svcRows.push(['25', 'SMTP', 'MX record present']);
  webSecs.push(svcRows.length
    ? { title: 'Exposed services', status: 'discovered', blocks: [
        { type: 'table', headers: ['Port', 'Service', 'Evidence'], rows: svcRows },
        { type: 'note', text: 'Only services the unauthenticated probe could attest to (HTTP/TLS + MX record). This is not a full port scan.' },
      ] }
    : noteSec('Exposed services', 'No services attested by the outside-in probe (no live HTTP/TLS, no MX).'));

  // HTTP security headers — real when the host answered HTTP; unknown otherwise.
  const HDRS: [string, string][] = [['hsts', 'HSTS'], ['csp', 'CSP'], ['x_frame_options', 'X-Frame-Options'], ['x_content_type_options', 'X-Content-Type-Options'], ['referrer_policy', 'Referrer-Policy'], ['permissions_policy', 'Permissions-Policy']];
  const present = pr?.security_headers || {};
  webSecs.push({ title: 'HTTP security headers', status: live ? 'discovered' : 'not collected', blocks: [{ type: 'kv', items: HDRS.map(([k, lbl]) =>
    live
      ? (present[k] ? { label: lbl, value: '✓ set', tone: 'ok' } : { label: lbl, value: '✗ missing', tone: (k === 'hsts' || k === 'csp') ? 'bad' : 'warn' })
      : ncItem(lbl)) }] });

  groups.push({ key: 'web', label: 'Web, TLS & Exposure Telemetry', pill: 'Web, TLS & Exposure', sub: 'Certificates, exposed services & HTTP posture · unauthenticated scan', sections: webSecs });

  // ── Infrastructure Telemetry ───────────────────────────────────────────────
  // IP + CDN/WAF are real; ASN, Region, Reverse DNS and Hosting type need a
  // passive-DNS / IP-intel source the probe doesn't call — honest "not collected".
  const ip = asset?.ip_address || pr?.ip;
  const cdn = pr?.cdn_waf;
  // Hosting type — derived HONESTLY from reverse DNS + ASN org (real probe fields),
  // not a keyed intel source. e.g. rDNS "lv-shared04.dapanel.net" + ASN
  // "WebHostingHoldings" → shared hosting.
  const hostingType = (() => {
    const blob = `${pr?.reverse_dns || ''} ${pr?.asn_org || ''}`.toLowerCase();
    if (!blob.trim()) return null;
    if (/\b(aws|amazon|ec2|azure|google|gcp|cloudfront|digitalocean|linode|akamai|fastly|vultr|ovh|hetzner|oracle\s*cloud)\b/.test(blob)) return 'Cloud / CDN';
    if (/shared|cpanel|dapanel|whm|hostgator|bluehost|namecheap|godaddy|webhosting|hostinger|siteground/.test(blob)) return 'Shared hosting';
    if (/\b(vps|virtual\s*server)\b/.test(blob)) return 'VPS';
    if (/\b(dedi|dedicated)\b/.test(blob)) return 'Dedicated server';
    return 'Hosting provider';
  })();
  groups.push({ key: 'infra', label: 'Infrastructure Telemetry', pill: 'Infrastructure', sub: 'Hosting, network ownership & edge · passive + active probes', sections: [
    { title: 'Hosting & network', status: (ip || cdn || pr?.asn || pr?.reverse_dns) ? 'discovered' : 'not collected', blocks: [{ type: 'kv', items: [
      { label: 'IP address', value: ip || '—', mono: ip ? true : undefined },
      (pr?.asn ? { label: 'ASN', value: `AS${pr.asn}${pr.asn_org ? ` · ${pr.asn_org}` : ''}` } : kvOrNC('ASN', pr?.asn_org)),
      kvOrNC('Region', pr?.ip_region),
      kvOrNC('Reverse DNS', pr?.reverse_dns, true),
      { label: 'CDN / WAF', value: cdn || (live ? 'none detected' : NC), tone: cdn ? 'ok' : 'muted' },
      (hostingType ? { label: 'Hosting type', value: hostingType } : ncItem('Hosting type')),
    ] }] },
  ] });

  // ── Discovery & evidence ───────────────────────────────────────────────────
  groups.push({ key: 'discovery', label: 'Discovery & evidence', pill: 'Discovery & evidence', sub: 'How this external asset was found & last crawled', sections: [
    { title: 'Discovery & evidence', status: 'discovered', blocks: [{ type: 'kv', items: [
      { label: 'Source', value: asset?.origin_source || asset?.discovery_source || '—' },
      { label: 'Evidence', value: asset?.discovery_source || (asset?.origin_source === 'easm' ? 'Outside-in probe · DNS / TLS / certificate transparency' : '—') },
      { label: 'First discovered', value: date10(asset?.first_seen_at || asset?.created_at) },
      { label: 'Last crawl', value: pr?.probed_at ? date10(pr.probed_at) : '—' },
      { label: 'Confidence', value: '—', tone: 'muted' },
    ] }] },
  ] });

  return groups;
}

export interface OverviewOpts {
  software?: any[];
  posture?: any;
  kpis?: { riskScore?: any; openFindings?: any; blastRadius?: any; controlCoverage?: any; refreshDue?: any };
  tabs?: { label: string; count?: number; active?: boolean; onClick?: () => void }[];
  actions?: { label: string; primary?: boolean; danger?: boolean; onClick?: () => void }[];
  onEdit?: () => void;
  onSoftwareClick?: (s: any) => void;
  // AI layout plan (Layer 2). null/undefined → generic cards exactly as before.
  plan?: { fields: Array<{ key: string; heading: string; card: string }>; cards: Array<{ name: string; size: 'half' | 'full'; order: number }> } | null;
}

export function buildOverviewData(asset: any, o: OverviewOpts = {}): any {
  const pp = asset?.platform_properties || {};
  const kind = (asset?.platform_kind && asset.platform_kind !== 'server') ? asset.platform_kind
    : (asset?.os_family || asset?.platform_kind === 'server' ? 'server' : (asset?.platform_kind || 'server'));
  const software = o.software || asset?.detected_software_json || [];
  const posture = o.posture || asset?.security_posture || {};
  const dash = (v: any) => (isEmpty(v) ? '—' : v);
  const date = (s: any) => (s ? String(s).slice(0, 10) : '—');
  const K = o.kpis || {};

  const probe = pp?.external_probe;
  const outside = isOutsideOnly(asset);
  const subCount = Array.isArray(asset?.dns_aliases) ? asset.dns_aliases.filter(Boolean).length : 0;
  const _vulns = Array.isArray(asset?.linked_vulnerabilities) ? asset.linked_vulnerabilities : [];
  const highCount = _vulns.filter((v: any) => ['high', 'critical'].includes(String(v?.severity || '').toLowerCase())).length;

  const isApp = asset?.asset_type === 'application';
  const KIND_LABEL: Record<string, string> = { server: 'host', database: 'database', network: 'network device', cloud: 'cloud account', cluster: 'cluster', identity: 'directory' };
  // External (EASM) assets have no {status,data} platform sections — their deep
  // telemetry is built straight from the flat external_probe dict instead.
  const deep = outside
    ? { groups: buildExternalDeep(asset, probe), notes: { denied: [], absent: [] } }
    : buildDeep(pp, kind, isLinux(asset));
  // A software-promoted app has no deep inventory of its own — nudge toward the
  // richer path (connect it as a database with a DB login) instead of a blank card.
  if (isApp && deep.groups.length === 0) {
    deep.notes = { denied: [], absent: [] };
  }

  // External (EASM) assets carry outside-in probe facts (HTTP/TLS) in
  // platform_properties.external_probe. buildMachineCards returns via several
  // kind-specific branches, so append the exposure card HERE — after whichever
  // branch ran — not inside one branch that other asset types skip.
  // Layer 2 first: if an AI layout plan is present and places at least one real
  // value, it REPLACES the hardcoded machine cards. Otherwise Layer 1 (the
  // existing kind-specific / generic cards) renders exactly as before.
  const scanNoteTop = isOutsideOnly(asset) ? 'Outside-in probe' : 'Agentless scan';
  const planned = o.plan ? buildPlannedCards(asset, pp, o.plan, scanNoteTop) : null;
  const machineCards = planned ?? buildMachineCards(asset, pp, kind, isLinux(asset));
  // EASM health grade + outside-in hygiene parameters. Built once so BOTH render
  // paths surface them — the generic exposure card AND an AI layout plan's
  // Exposure card (which only enumerates raw probe keys, not the derived health).
  const probeFields = (pr: any) => {
    const h = pr.health || {};
    const gradeTone = !h.grade ? 'muted' : (['A', 'B'].includes(h.grade) ? 'ok' : h.grade === 'C' ? 'warn' : 'bad');
    const secN = Object.keys(pr.security_headers || {}).length;
    const hasMx = Array.isArray(pr.dns_mx) && pr.dns_mx.length > 0;
    return [
      { label: 'Health score', value: h.grade ? `${h.grade} · ${h.score}/100` : (h.reason || 'not graded'), tone: gradeTone },
      { label: 'Response time', value: pr.response_time_ms != null ? `${pr.response_time_ms} ms` : '—' },
      { label: 'HTTPS / TLS', value: pr.https_available ? (pr.tls_version || 'Yes') : 'No', tone: pr.https_available ? 'ok' : 'bad' },
      { label: 'Cert expires', value: pr.tls_not_after ? `${String(pr.tls_not_after).slice(0, 10)}${pr.tls_days_to_expiry != null ? ` (${pr.tls_days_to_expiry}d)` : ''}` : '—', tone: pr.tls_expired ? 'bad' : (pr.tls_not_after ? 'ok' : 'muted') },
      { label: 'Security headers', value: `${secN}/6 set`, tone: secN >= 5 ? 'ok' : secN >= 2 ? 'warn' : 'bad' },
      { label: 'Email (SPF/DMARC)', value: hasMx ? `${pr.spf ? 'SPF ✓' : 'SPF ✗'} · ${pr.dmarc ? 'DMARC ✓' : 'DMARC ✗'}` : 'no MX', tone: !hasMx ? 'muted' : (pr.spf && pr.dmarc ? 'ok' : 'warn') },
    ];
  };
  let machine = machineCards;
  if (probe && planned) {
    // AI plan drives the cards — inject the derived health fields at the top of
    // its Exposure card so the grade isn't lost among the raw probe keys.
    const expo = planned.find((c: any) => /exposure|internet/i.test(c.title || '')) || planned[0];
    if (expo) expo.fields = [...probeFields(probe), ...(expo.fields || [])];
  } else if (probe) {
    machine = [...machineCards, {
      title: 'Internet exposure',
      note: `outside-in probe${probe.probed_at ? ' · ' + String(probe.probed_at).slice(0, 10) : ''}`,
      fields: [
        ...probeFields(probe),
        { label: 'Reachable', value: probe.live ? 'Yes' : 'No', tone: probe.live ? 'ok' : 'muted' },
        { label: 'HTTP status', value: probe.status_code != null ? String(probe.status_code) : '—' },
        { label: 'Server', value: probe.server || '—' },
        { label: 'Cert issuer', value: probe.tls_issuer || '—' },
        { label: 'Page title', value: probe.title || '—' },
      ],
    }];
  }

  // Health-score breakdown — how the grade·score is composed, dimension by
  // dimension. Same signals as the Risk & Controls / posture breakdown, shown
  // here as HEALTH (higher = better). It is NOT rendered as an always-on card;
  // it hangs off the "Attack-surface hygiene" KPI tile and is revealed only
  // when the operator clicks that tile (see _overview-design).
  const _hc = probe?.health?.components;
  let hygieneBreakdown: any[] | null = null;
  if (probe && _hc && Object.keys(_hc).length) {
    // The full parameter set the health score considers. Any of these with no
    // data for THIS host (no MX, no cookies, no CDN) is dropped from the maths —
    // we show it as N/A so the operator sees all params were weighed, not that
    // some silently vanished ("why 6 not 8").
    const _LBL: Record<string, string> = {
      tls: 'TLS / certificate', headers: 'Security headers', transport: 'HTTPS / redirects',
      hsts: 'HSTS', cookies: 'Cookie flags', latency: 'Response time',
      email: 'Email auth (SPF/DMARC/DKIM)', cdn: 'CDN / WAF',
    };
    const _NA: Record<string, string> = {
      tls: 'not probed', headers: 'host not reachable', transport: 'host not reachable',
      hsts: 'host not reachable', cookies: 'this host sets no cookies',
      latency: 'response time not measured', email: 'no MX — this host does not receive mail',
      cdn: 'no CDN / WAF fingerprint (often hidden by design)',
    };
    const present = Object.entries(_hc).map(([k, c]: [string, any]) => {
      const pct = Math.round((c.score ?? 0) * 100);
      const w = c.weight_pct ?? Math.round((c.weight ?? 0) * 100);
      return { key: k, label: `${c.label || _LBL[k] || k}`, weightPct: w, value: `${pct}/100 · ${c.detail || ''}`, pct, applicable: true, tone: pct >= 75 ? 'ok' : pct >= 40 ? 'warn' : 'bad' };
    });
    const shown = new Set(Object.keys(_hc));
    const missing = Object.keys(_LBL).filter((k) => !shown.has(k)).map((k) => ({
      key: k, label: _LBL[k], weightPct: null, value: `N/A — ${_NA[k] || 'not applicable to this host'}`, pct: null, applicable: false, tone: 'muted',
    }));
    hygieneBreakdown = [...present, ...missing];
  }

  // ── External (EASM) KPI strip — 5 tiles from real probe/finding facts, each
  // OMITTED when its data is absent (never faked). Replaces the internal set. ──
  const extKpis = (() => {
    const out: any[] = [];
    const of = K.openFindings ?? 0;
    if (K.riskScore != null && K.riskScore !== '') {
      out.push({ label: 'Risk Score', value: dash(K.riskScore), sub: 'Assessed' });
    } else if (probe?.health?.grade) {
      out.push({ label: 'Risk Score', value: `${probe.health.grade} · ${probe.health.score}`,
        sub: hygieneBreakdown ? 'Outside-in health · click for breakdown' : 'Outside-in health (not risk)',
        tone: ['A', 'B'].includes(probe.health.grade) ? 'ok' : probe.health.grade === 'C' ? 'warn' : 'bad',
        breakdown: hygieneBreakdown, breakdownTitle: `Attack-surface hygiene — ${probe.health.grade} · ${probe.health.score}/100`,
        breakdownNote: 'Formula: score = ( Σ parameter × weight ) ÷ ( Σ weights of the applicable parameters ) × 100. Each row shows its % weight. Higher is healthier. Parameters that don’t apply to this host (no mail, no cookies, no CDN) are marked N/A and left out of the maths — never scored 0.' });
    } else {
      out.push({ label: 'Risk Score', value: '—', sub: 'Not assessed', tone: 'muted' });
    }
    out.push({ label: 'Open Findings', value: String(of), sub: of ? (highCount ? `${highCount} high` : 'Needs attention') : 'None open', tone: of ? 'bad' : 'ok' });
    if (subCount > 0) out.push({ label: 'Subdomains', value: String(subCount), sub: 'discovered' });
    const svc = extExposedServices(probe);
    if (svc.length) out.push({ label: 'Exposed Services', value: String(svc.length), sub: svc.map((s) => s.toLowerCase()).join(' · ') });
    if (probe?.tls_not_after) {
      const d = probe.tls_days_to_expiry;
      out.push({ label: 'Cert Expiry', value: probe.tls_expired ? 'expired' : (typeof d === 'number' ? `${d}d` : '—'), sub: fmtDay(probe.tls_not_after),
        tone: probe.tls_expired || (typeof d === 'number' && d <= 14) ? 'bad' : (typeof d === 'number' && d <= 30 ? 'warn' : 'ok') });
    }
    return out;
  })();

  // ── External posture signals — the rail rows. Real probe/finding facts; each
  // omitted when absent (an unprobed host may surface only Open findings). ──
  const extSignals = (() => {
    const out: any[] = [];
    if (probe?.health?.grade) out.push({ label: 'TLS grade', value: probe.tls_version ? `${probe.health.grade} · ${probe.tls_version}` : probe.health.grade, tone: ['A', 'B'].includes(probe.health.grade) ? 'ok' : probe.health.grade === 'C' ? 'warn' : 'bad' });
    if (probe?.tls_not_after) {
      const d = probe.tls_days_to_expiry;
      const parts: string[] = [];
      if (typeof d === 'number') parts.push(`${d} day${d === 1 ? '' : 's'}`);
      parts.push(fmtDay(probe.tls_not_after));
      out.push({ label: 'Certificate expiry', value: probe.tls_expired ? 'expired' : parts.join(' · '), tone: probe.tls_expired || (typeof d === 'number' && d <= 14) ? 'bad' : (typeof d === 'number' && d <= 30 ? 'warn' : 'ok') });
    }
    if (probe && Array.isArray(probe.dns_mx) && probe.dns_mx.length) out.push({ label: 'Email security', value: `${probe.spf ? 'SPF ✓' : 'SPF ✗'} · ${probe.dmarc ? 'DMARC ✓' : 'DMARC ✗'}`, tone: probe.spf && probe.dmarc ? 'ok' : 'warn' });
    const svc = extExposedServices(probe);
    if (svc.length) out.push({ label: 'Exposed services', value: String(svc.length) });
    const of = K.openFindings ?? 0;
    out.push({ label: 'Open findings', value: highCount ? `${of} · ${highCount} high` : String(of), tone: of ? (highCount ? 'bad' : 'warn') : 'ok' });
    return out;
  })();

  return {
    legend: { machine: `${asset?.last_seen_source || 'agentless'} scan · ${date(asset?.last_seen_at)}` },
    // External (EASM) assets aren't agentless-collected — let the design relabel.
    external: isOutsideOnly(asset),
    header: {
      name: asset?.name || asset?.host_name || `Asset #${asset?.id}`,
      avatar: (asset?.name || 'A').charAt(0).toUpperCase(),
      tags: [
        { label: asset?.asset_type || 'Asset' },
        { label: asset?.status || 'active', tone: (asset?.status || 'active') === 'active' ? 'ok' : undefined },
        // Mirror the register's Internet-facing pill on the detail header so the
        // exposure signal doesn't vanish when you open the asset.
        ...(asset?.internet_facing ? [{ label: 'Internet-facing', tone: 'bad' }] : []),
      ],
      description: asset?.description || 'No description',
      idline: isApp
        ? ['application', asset?.os_version || asset?.name,
          asset?.parent_asset_id ? `runs on ${asset?.host_name || `#${asset.parent_asset_id}`}` : null].filter(Boolean).join(' · ')
        : outside
          ? ['apex domain', subCount > 0 ? `${subCount} subdomain${subCount === 1 ? '' : 's'}` : null, asset?.ip_address].filter(Boolean).join(' · ')
          : [asset?.asset_type, KIND_LABEL[kind], asset?.os_version || asset?.os_family,
            asset?.source_system === 'discovery' ? 'discovered on network' : null].filter(Boolean).join(' · '),
    },
    actions: o.actions || [],
    tabs: o.tabs || [],
    kpis: outside ? extKpis : [
      // External (EASM) assets are graded on exposure health, not a CIA risk
      // score — surface the health grade here so the tile isn't "Not assessed".
      probe?.health?.grade
        ? { label: 'Attack-surface hygiene', value: `${probe.health.grade} · ${probe.health.score}`, sub: hygieneBreakdown ? 'Outside-in health — click for breakdown' : 'Outside-in health (not risk)', tone: ['A', 'B'].includes(probe.health.grade) ? 'ok' : probe.health.grade === 'C' ? 'warn' : 'bad', breakdown: hygieneBreakdown, breakdownTitle: `Attack-surface hygiene — ${probe.health.grade} · ${probe.health.score}/100`, breakdownNote: 'Formula: score = ( Σ parameter × weight ) ÷ ( Σ weights of the applicable parameters ) × 100. Each row shows its % weight. Higher is healthier. Parameters that don’t apply to this host (no mail, no cookies, no CDN) are marked N/A and left out of the maths — never scored 0.' }
        : { label: 'Risk Score', value: dash(K.riskScore), sub: K.riskScore ? 'Assessed' : 'Not assessed', tone: K.riskScore ? undefined : 'muted' },
      { label: 'Open Findings', value: String(K.openFindings ?? 0), sub: (K.openFindings ?? 0) ? 'Needs attention' : 'None open', tone: (K.openFindings ?? 0) ? 'bad' : 'ok' },
      { label: 'Blast Radius', value: String(K.blastRadius ?? 0), sub: (K.blastRadius ?? 0) ? 'Dependents mapped' : 'No dependents mapped', tone: 'muted' },
      { label: 'Control Coverage', value: `${Math.round(K.controlCoverage ?? 0)}%`, sub: (K.controlCoverage ?? 0) ? 'Controls mapped' : 'No controls mapped', tone: (K.controlCoverage ?? 0) >= 50 ? 'ok' : 'warn', bar: Math.round(K.controlCoverage ?? 0) },
      { label: 'Refresh Due', value: dash(K.refreshDue), sub: K.refreshDue ? 'Scheduled' : 'Not scheduled', tone: 'muted' },
    ],
    machine,
    manual: [
      {
        title: 'Identity & Ownership', note: 'Manual entry', onEdit: o.onEdit,
        fields: [
          { label: 'Category', value: dash(asset?.asset_type) },
          { label: 'Assigned User', value: dash(asset?.assigned_user) },
          { label: 'Owner', value: dash(asset?.owner_name) },
          { label: 'Custodian', value: dash(asset?.custodian) },
          { label: 'Department', value: dash(asset?.department) },
          { label: 'Environment', value: dash(asset?.environment) },
          { label: 'Location', value: dash(asset?.location) },
          { label: 'Criticality', value: dash(asset?.criticality) },
          { label: 'Lifecycle', value: dash(asset?.lifecycle_state) },
          { label: 'Data Classification', value: dash(asset?.data_classification) },
          { label: 'Business Function', value: dash(asset?.business_function) },
          { label: 'Owning Team', value: dash(asset?.owning_team_name || asset?.owning_team) },
          { label: 'Secondary Owner', value: dash(asset?.secondary_owner_name) },
          { label: 'Business Owner', value: dash(asset?.business_owner_name) },
          { label: 'Escalation Contact', value: dash(asset?.escalation_contact_name) },
        ],
      },
      {
        title: 'Procurement & Cost', note: 'Manual · finance / CMDB', onEdit: o.onEdit,
        fields: [
          { label: 'Vendor', value: dash(asset?.vendor) },
          { label: 'Purchase Cost', value: dash(asset?.purchase_cost) },
          { label: 'Purchase Date', value: date(asset?.purchase_date) },
          { label: 'Warranty Expiry', value: date(asset?.warranty_expiry) },
          { label: 'End of Life', value: date(asset?.eol_date) },
          { label: 'Valuation', value: dash(asset?.valuation) },
        ],
      },
    ],
    security: {
      // An external (EASM) host was never logged into, so AV / EDR / packages are
      // UNKNOWN — not "none". Rendering "None detected" in red for these was a
      // false alarm (it reads as a finding). Show the honest state in a neutral tone.
      signals: outside ? extSignals : [
        { label: 'Antivirus', value: posture?.has_antivirus ? (posture.antivirus_products?.join(', ') || 'Present') : 'None detected', tone: posture?.has_antivirus ? 'ok' : 'bad' },
        { label: 'EDR', value: posture?.has_edr ? (posture.edr_products?.join(', ') || 'Present') : 'None detected', tone: posture?.has_edr ? 'ok' : 'bad' },
        { label: 'Endpoint Protected', value: posture?.endpoint_protected ? 'Yes' : 'No', tone: posture?.endpoint_protected ? 'ok' : 'bad' },
        { label: 'Packages Found', value: String(posture?.software_total ?? software.length), tone: 'muted' },
      ],
      softwareHeaders: ['Name', 'Version', 'Tracked as asset'],
      software: (software || []).map((s: any) => ({
        name: s.name || '—',
        version: s.version || '—',
        tracked: s.promoted_asset_id ? `Asset #${s.promoted_asset_id}` : (s.benchmark_available ? 'Click to set up' : '—'),
        onClick: s.software_key && o.onSoftwareClick ? () => o.onSoftwareClick!(s) : undefined,
      })),
    },
    deep: deep.groups,
    deepNote: deep.notes,
  };
}
