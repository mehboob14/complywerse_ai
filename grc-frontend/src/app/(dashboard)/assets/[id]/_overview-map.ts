/*
 * Maps the live asset-detail API payload into the exact data shape the delivered
 * AssetOverview design consumes — for EVERY asset kind (Windows/Linux host,
 * database, network device, cloud account, cluster, directory). The design
 * component is used verbatim; all per-kind adaptation happens here, so each kind
 * renders in the same clean, structured layout with its OWN fields.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */


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

  const isApp = asset?.asset_type === 'application';
  const KIND_LABEL: Record<string, string> = { server: 'host', database: 'database', network: 'network device', cloud: 'cloud account', cluster: 'cluster', identity: 'directory' };
  const deep = buildDeep(pp, kind, isLinux(asset));
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
  const probe = pp?.external_probe;
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
    const _LBL: Record<string, string> = {
      tls: 'TLS / certificate', headers: 'Security headers', transport: 'HTTPS / redirects',
      hsts: 'HSTS', cookies: 'Cookie flags', latency: 'Response time',
      email: 'Email auth (SPF/DMARC/DKIM)', cdn: 'CDN / WAF',
    };
    hygieneBreakdown = Object.entries(_hc).map(([k, c]: [string, any]) => {
      const pct = Math.round((c.score ?? 0) * 100);
      const w = c.weight_pct ?? Math.round((c.weight ?? 0) * 100);
      return { label: `${c.label || _LBL[k] || k}`, weightPct: w, value: `${pct}/100 · ${c.detail || ''}`, pct, tone: pct >= 75 ? 'ok' : pct >= 40 ? 'warn' : 'bad' };
    });
  }

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
        : [asset?.asset_type, KIND_LABEL[kind], asset?.os_version || asset?.os_family,
          isOutsideOnly(asset) ? 'discovered externally · internet-facing'
            : asset?.source_system === 'discovery' ? 'discovered on network' : null].filter(Boolean).join(' · '),
    },
    actions: o.actions || [],
    tabs: o.tabs || [],
    kpis: [
      // External (EASM) assets are graded on exposure health, not a CIA risk
      // score — surface the health grade here so the tile isn't "Not assessed".
      probe?.health?.grade
        ? { label: 'Attack-surface hygiene', value: `${probe.health.grade} · ${probe.health.score}`, sub: hygieneBreakdown ? 'Outside-in health — click for breakdown' : 'Outside-in health (not risk)', tone: ['A', 'B'].includes(probe.health.grade) ? 'ok' : probe.health.grade === 'C' ? 'warn' : 'bad', breakdown: hygieneBreakdown, breakdownTitle: `Attack-surface hygiene — ${probe.health.grade} · ${probe.health.score}/100`, breakdownNote: 'How this score is composed. Each row = its % weight of the score. Higher is healthier. Unknown signals (no cookies, no MX, no CDN) drop out instead of scoring 0.' }
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
      signals: isOutsideOnly(asset) ? [
        { label: 'Antivirus', value: 'Not observable from outside', tone: 'muted' },
        { label: 'EDR', value: 'Not observable from outside', tone: 'muted' },
        { label: 'Endpoint Protected', value: 'Unknown — no login', tone: 'muted' },
        { label: 'Weak Spots', value: 'Run a Nessus scan on this host to find them', tone: 'muted' },
      ] : [
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
