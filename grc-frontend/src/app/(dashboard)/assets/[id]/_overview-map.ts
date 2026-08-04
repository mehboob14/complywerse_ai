/*
 * Maps the live asset-detail API payload into the exact data shape the delivered
 * AssetOverview design consumes — for EVERY asset kind (Windows/Linux host,
 * database, network device, cloud account, cluster, directory). The design
 * component is used verbatim; all per-kind adaptation happens here, so each kind
 * renders in the same clean, structured layout with its OWN fields.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

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
    { title: 'Security', keys: ['defender', 'firewall', 'bitlocker', 'selinux', 'apparmor', 'sshd'] },
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

  const netPlatform = {
    title: 'Network & Platform', note: 'Agentless scan',
    fields: [
      { label: 'IP Address', value: dash(asset?.ip_address), mono: true },
      { label: 'Network Segment', value: dash(asset?.network_segment), mono: true },
      { label: 'Hostname', value: dash(asset?.host_name) },
      { label: 'FQDN', value: dash(asset?.fqdn) },
      { label: 'MAC Address', value: dash(asset?.primary_mac), mono: true },
      { label: 'Internet Exposed', value: asset?.internet_facing ? 'Yes' : 'No', tone: asset?.internet_facing ? 'bad' : 'ok' },
    ],
  };

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
        title: 'Hardware & Telemetry', note: 'Agentless scan',
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
        title: 'Hardware & Telemetry', note: 'Agentless scan',
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
  const summary = { title: title[kind] || 'Platform', note: 'Agentless scan',
    fields: [...flat, ...counts].length ? [...flat, ...counts] : [{ label: 'Details', value: 'See sections below' }] };
  // Cloud accounts have no LAN identity — skip the IP/MAC card entirely.
  return kind === 'cloud' ? [summary] : [netPlatform, summary];
}

export interface OverviewOpts {
  software?: any[];
  posture?: any;
  kpis?: { riskScore?: any; openFindings?: any; blastRadius?: any; controlCoverage?: any; refreshDue?: any };
  tabs?: { label: string; count?: number; active?: boolean; onClick?: () => void }[];
  actions?: { label: string; primary?: boolean; danger?: boolean; onClick?: () => void }[];
  onEdit?: () => void;
  onSoftwareClick?: (s: any) => void;
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

  const KIND_LABEL: Record<string, string> = { server: 'host', database: 'database', network: 'network device', cloud: 'cloud account', cluster: 'cluster', identity: 'directory' };
  const deep = buildDeep(pp, kind, isLinux(asset));

  return {
    legend: { machine: `${asset?.last_seen_source || 'agentless'} scan · ${date(asset?.last_seen_at)}` },
    header: {
      name: asset?.name || asset?.host_name || `Asset #${asset?.id}`,
      avatar: (asset?.name || 'A').charAt(0).toUpperCase(),
      tags: [
        { label: asset?.asset_type || 'Asset' },
        { label: asset?.status || 'active', tone: (asset?.status || 'active') === 'active' ? 'ok' : undefined },
      ],
      description: asset?.description || 'No description',
      idline: [asset?.asset_type, KIND_LABEL[kind], asset?.os_version || asset?.os_family,
        asset?.source_system === 'discovery' ? 'discovered on network' : null].filter(Boolean).join(' · '),
    },
    actions: o.actions || [],
    tabs: o.tabs || [],
    kpis: [
      { label: 'Risk Score', value: dash(K.riskScore), sub: K.riskScore ? 'Assessed' : 'Not assessed', tone: K.riskScore ? undefined : 'muted' },
      { label: 'Open Findings', value: String(K.openFindings ?? 0), sub: (K.openFindings ?? 0) ? 'Needs attention' : 'None open', tone: (K.openFindings ?? 0) ? 'bad' : 'ok' },
      { label: 'Blast Radius', value: String(K.blastRadius ?? 0), sub: (K.blastRadius ?? 0) ? 'Dependents mapped' : 'No dependents mapped', tone: 'muted' },
      { label: 'Control Coverage', value: `${Math.round(K.controlCoverage ?? 0)}%`, sub: (K.controlCoverage ?? 0) ? 'Controls mapped' : 'No controls mapped', tone: (K.controlCoverage ?? 0) >= 50 ? 'ok' : 'warn', bar: Math.round(K.controlCoverage ?? 0) },
      { label: 'Refresh Due', value: dash(K.refreshDue), sub: K.refreshDue ? 'Scheduled' : 'Not scheduled', tone: 'muted' },
    ],
    machine: buildMachineCards(asset, pp, kind, isLinux(asset)),
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
      signals: [
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
