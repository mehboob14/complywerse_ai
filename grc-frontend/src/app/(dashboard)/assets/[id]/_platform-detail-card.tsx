'use client';

/**
 * Typed-asset detail — the per-platform component card.
 *
 * A server shows VCPU/RAM/OS; a database/router/cloud-account/directory/cluster
 * has a COMPLETELY different model. The backend collects each kind's own facts
 * into `platform_properties` and tags `platform_kind`; this renders the right
 * card so a Postgres asset shows version/databases/extensions/settings instead
 * of blank server tiles. Server assets never reach here (they keep the existing
 * Hardware & Telemetry card).
 */
import { Database, Network, Cloud, KeyRound, Boxes } from 'lucide-react';

export const PLATFORM_META: Record<string, { title: string; icon: any }> = {
  database: { title: 'Database Engine', icon: Database },
  network: { title: 'Network Device', icon: Network },
  cloud: { title: 'Cloud Account', icon: Cloud },
  identity: { title: 'Directory', icon: KeyRound },
  cluster: { title: 'Cluster', icon: Boxes },
};

function Row({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === '' ||
      (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm text-slate-800 break-words">
        {Array.isArray(value) ? value.join(', ') : String(value)}
      </div>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${
      ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{label}</span>
  );
}

export function PlatformDetails({ kind, props }: { kind: string; props: any }) {
  const p = props || {};
  if (!props) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        No platform details collected yet — reconnect / scan this asset to populate them.
      </div>
    );
  }

  if (kind === 'database') {
    const exts: any[] = p.extensions || [];
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Row label="Engine" value={p.engine} />
          <Row label="Version" value={p.version} />
          <Row label="Port" value={p.port} />
          <Row label="Databases" value={p.database_count} />
          <Row label="Extensions" value={exts.length || null} />
          <Row label="Roles" value={p.role_count} />
          <Row label="Superusers" value={p.superusers} />
          <Row label="Login roles" value={p.login_roles} />
        </div>
        {p.databases?.length ? <Row label="Database list" value={p.databases} /> : null}
        {exts.length ? <Row label="Extension list" value={exts.map((e: any) => `${e.name} ${e.version || ''}`.trim())} /> : null}
        <div className="flex flex-wrap gap-2">
          {p.ssl_enabled !== undefined && <Badge ok={!!p.ssl_enabled} label={p.ssl_enabled ? 'SSL on' : 'SSL off'} />}
          {p.publicly_listening !== undefined && <Badge ok={!p.publicly_listening} label={p.publicly_listening ? 'Listening on all interfaces' : 'Localhost only'} />}
        </div>
        {p.settings ? (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer font-medium">Security settings</summary>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {Object.entries(p.settings).map(([k, v]: any) => (
                <div key={k}><span className="text-slate-500">{k}:</span> {String(v)}</div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  if (kind === 'network') {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Model" value={p.model} />
        <Row label="OS / Firmware" value={p.os_version} />
        <Row label="Serial" value={p.serial} />
        <Row label="Uptime" value={p.uptime} />
      </div>
    );
  }

  if (kind === 'cloud') {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Provider" value={p.provider} />
        <Row label="Account / Subscription" value={p.account_id || p.subscription_id} />
        <Row label="Home region" value={p.region} />
        <Row label="Regions" value={p.region_count} />
        <Row label="EC2 instances" value={p.ec2_instances} />
        <Row label="S3 buckets" value={p.s3_buckets} />
        <Row label="RDS instances" value={p.rds_instances} />
        <Row label="Resource groups" value={p.resource_group_count} />
        <Row label="Resources" value={p.resource_count} />
      </div>
    );
  }

  if (kind === 'identity') {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Domain (base DN)" value={p.defaultNamingContext} />
        <Row label="DC hostname" value={p.dnsHostName} />
        <Row label="Domain functional level" value={p.domainFunctionality} />
        <Row label="Forest functional level" value={p.forestFunctionality} />
        <Row label="Users" value={p.user_count} />
        <Row label="Computers" value={p.computer_count} />
        <Row label="OUs" value={p.ou_count} />
      </div>
    );
  }

  if (kind === 'cluster') {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Provider" value={p.provider} />
        <Row label="Version" value={p.version} />
        <Row label="Nodes" value={p.node_count} />
        <Row label="Namespaces" value={p.namespace_count} />
        <Row label="Pods" value={p.pod_count} />
      </div>
    );
  }

  return <div className="text-xs text-slate-500">No renderer for platform kind “{kind}”.</div>;
}
