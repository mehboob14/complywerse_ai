// The sources a review can draw on, grouped the way a person looks for them. The server decides
// what is connected and what each source put in the population; this decides what each is
// called and which form connects it.

import type { ConnectorField, ConnectorStatus } from '../../api';
import type { ConnectorSource } from '../../types';

export type Vendor = {
  key: string; name: string; sub: string; initials: string;
  /** a dark tint: white initials on it clear 4.5:1 */
  color: string;
  kind: 'sso' | 'form' | 'iga' | 'app' | 'upload';
  endpoint?: string;                 // a form connector posts to /connectors/{endpoint}/sync
  /** its credential can be kept (encrypted) so later reviews refresh on their own */
  remembers?: boolean;
  fields?: ConnectorField[];         // IGA and app fields come from the server's catalog
};
export type Category = { id: string; title: string; sub: string; vendors: Vendor[] };

export const CATEGORIES: Category[] = [
  {
    id: 'directories', title: 'Directories and login', sub: 'Who exists, and their basic roles.',
    vendors: [
      { key: 'entra', name: 'Microsoft Entra ID', sub: 'Single sign-on and user provisioning', initials: 'MS', color: '#1D4ED8', kind: 'sso' },
      { key: 'okta', name: 'Okta', sub: 'API token', initials: 'OK', color: '#0F172A', kind: 'form', endpoint: 'okta',
        fields: [{ name: 'domain', label: 'Okta domain', ph: 'acme.okta.com' }, { name: 'token', label: 'API token', secret: true }] },
      { key: 'google', name: 'Google Workspace', sub: 'OAuth directory', initials: 'G', color: '#B91C1C', kind: 'form', endpoint: 'google',
        fields: [{ name: 'access_token', label: 'Access token', secret: true }, { name: 'customer', label: 'Customer ID', ph: 'my_customer' }] },
      { key: 'ldap', name: 'Active Directory / LDAP', sub: 'On-premises directory', initials: 'AD', color: '#1E40AF', kind: 'form', endpoint: 'ldap',
        fields: [{ name: 'server', label: 'Server', ph: 'dc01.acme.local' }, { name: 'base_dn', label: 'Base DN', ph: 'DC=acme,DC=local' },
          { name: 'bind_dn', label: 'Bind DN' }, { name: 'bind_password', label: 'Bind password', secret: true }] },
      { key: 'excel', name: 'Excel or CSV', sub: 'A one-time file upload', initials: 'XL', color: '#15803D', kind: 'upload' },
    ],
  },
  {
    id: 'iga', title: 'Identity governance (IGA)', sub: 'Full entitlements and approvals: the richest source.',
    vendors: [
      { key: 'sailpoint', name: 'SailPoint', sub: 'IdentityIQ or Identity Security Cloud', initials: 'SP', color: '#0F172A', kind: 'iga' },
      { key: 'saviynt', name: 'Saviynt', sub: 'Enterprise Identity Cloud', initials: 'SV', color: '#C2410C', kind: 'iga' },
      { key: 'oracle_ig', name: 'Oracle Identity', sub: 'Identity Governance', initials: 'OI', color: '#B91C1C', kind: 'iga' },
      { key: 'ibm_verify', name: 'IBM Verify', sub: 'Security Verify', initials: 'IB', color: '#1D4ED8', kind: 'iga' },
      { key: 'one_identity', name: 'One Identity', sub: 'Identity Manager', initials: '1I', color: '#1E40AF', kind: 'iga' },
      { key: 'ping', name: 'Ping Identity', sub: 'PingOne', initials: 'PI', color: '#B91C1C', kind: 'iga' },
      { key: 'jumpcloud', name: 'JumpCloud', sub: 'Directory platform', initials: 'JC', color: '#15803D', kind: 'iga' },
      { key: 'cyberark', name: 'CyberArk', sub: 'Identity Security', initials: 'CA', color: '#1E40AF', kind: 'iga' },
      { key: 'beyondtrust', name: 'BeyondTrust', sub: 'Privileged Remote Access', initials: 'BT', color: '#C2410C', kind: 'iga' },
    ],
  },
  {
    id: 'apps', title: 'Business apps and cloud', sub: 'Permissions inside the applications, where the real risk sits.',
    vendors: [
      // DigitalOcean publishes no team-member endpoint, so this pulls what it does expose: the keys,
      // tokens and database users that reach the estate. It is also tested against its own rules.
      { key: 'digitalocean', name: 'DigitalOcean', sub: 'SSH keys, Spaces keys, tokens, database users', initials: 'DO', color: '#0B5CAD',
        kind: 'form', endpoint: 'digitalocean', remembers: true,
        fields: [{ name: 'token', label: 'Read-only API token', secret: true, ph: 'Leave blank to use the connected token' }] },
      { key: 'core_banking', name: 'Core Banking', sub: 'REST API', initials: 'CB', color: '#0F172A', kind: 'app' },
      { key: 'sap', name: 'SAP', sub: 'Roles and profiles', initials: 'SA', color: '#0369A1', kind: 'app' },
      { key: 'salesforce', name: 'Salesforce', sub: 'Permission sets', initials: 'SF', color: '#1D4ED8', kind: 'app' },
      { key: 'oracle_ebs', name: 'Oracle EBS', sub: 'Responsibilities', initials: 'OE', color: '#B91C1C', kind: 'app' },
      { key: 'servicenow', name: 'ServiceNow', sub: 'Roles', initials: 'SN', color: '#15803D', kind: 'app' },
      { key: 'database', name: 'Databases', sub: 'Granted privileges', initials: 'DB', color: '#334155', kind: 'app' },
    ],
  },
];

export const ALL_VENDORS = CATEGORIES.flatMap((c) => c.vendors);

/** Is this vendor the one connected right now? (one IGA vendor and one app at a time) */
export function isConnected(status: ConnectorStatus | undefined, v: Vendor): boolean {
  if (!status) return false;
  if (v.kind === 'iga') { const g = status.iga as { connected?: boolean; vendor?: string } | undefined; return !!g?.connected && g.vendor === v.key; }
  if (v.kind === 'app') { const a = status.apps as { connected?: boolean; app?: string } | undefined; return !!a?.connected && a.app === v.key; }
  return !!(status[v.key] as { connected?: boolean } | undefined)?.connected;
}

/** The tags a vendor's people carry in the population, most specific first. */
export const sourceKeys = (v: Pick<Vendor, 'key' | 'kind'>): string[] =>
  v.kind === 'iga' ? [`iga:${v.key}`, v.key] : v.kind === 'app' ? [`app:${v.key}`, v.key] : v.key === 'entra' ? ['entra_id', 'entra'] : [v.key];

/** What a vendor has put in the population, if it has put anything. */
export function statFor(sources: ConnectorSource[], v: Pick<Vendor, 'key' | 'kind'>): ConnectorSource | undefined {
  for (const k of sourceKeys(v)) {
    const hit = sources.find((s) => s.key === k);
    if (hit) return hit;
  }
  return undefined;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
