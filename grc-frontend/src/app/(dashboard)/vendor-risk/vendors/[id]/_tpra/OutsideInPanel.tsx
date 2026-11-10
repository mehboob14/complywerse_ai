'use client';

// A supplier's websites and domains as the internet sees them: the score its
// findings earn, each finding with the host it was seen on, waivers, the hosts
// themselves, and ratings from the paid providers a tenant has connected.

import { useMemo, useState } from 'react';
import { ErrorState } from '@/components/ui/ds';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Globe, Loader2, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { vendorSecurityApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { fmtDate } from './constants';
import { errText } from '../../../_lib/intake/types';
import {
  GradeBadge, Meter, SCAN_PROVIDER, SEVERITY_CLS, SEVERITY_ORDER, Sparkline, riskCounts, type Finding, type VendorView,
} from '../../../_lib/security/ui';

const input = 'w-full rounded-ds-card border border-ds-border-strong px-3 py-2 text-[13px] focus-visible:border-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-strong';

export default function OutsideInPanel({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canScan = hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit');
  const canWaive = hasPermission('vendor_risk:findings:accept_risk');
  const [show, setShow] = useState<'open' | 'waived' | 'all'>('open');
  const [waiving, setWaiving] = useState<Finding | null>(null);

  const key = ['tprm-outside-in', vendorId];
  const { data, isLoading, isError, refetch } = useQuery<VendorView>({
    queryKey: key,
    queryFn: async () => (await vendorSecurityApi.vendor(vendorId)).data,
    refetchInterval: (q) => ((q.state.data as VendorView | undefined)?.running ? 4000 : false),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['tprm-outside-in-portfolio'] }); };
  const scan = useMutation({
    mutationFn: () => vendorSecurityApi.scan(vendorId),
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Scan started', message: 'It takes a minute or two.' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not start the scan', message: errText(e, 'Try again.') }),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => vendorSecurityApi.revokeWaiver(id),
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Waiver revoked' }); },
    onError: (e) => toast({ type: 'error', title: 'Not revoked', message: errText(e, 'Try again.') }),
  });

  const findings = useMemo(() => {
    const all = data?.latest?.findings || [];
    const kept = all.filter((f) => show === 'all' || (show === 'waived' ? !!f.waiver : !f.waiver));
    return SEVERITY_ORDER.flatMap((s) => kept.filter((f) => f.severity === s));
  }, [data, show]);

  if (isLoading) return <div className="flex items-center gap-2 py-10 text-[13px] text-ds-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (isError || !data) return <ErrorState compact title="Couldn’t load the outside-in view" onRetry={() => { void refetch(); }} />;

  const latest = data.latest;
  const history = data.history;
  const previous = history.length > 1 ? history[history.length - 2].score : null;
  const delta = latest?.scanned_score != null && previous != null ? latest.scanned_score - previous : null;
  const every = data.every_days[(data.vendor.tier || 'medium').toLowerCase()] ?? data.every_days.medium;
  const openCount = (latest?.findings || []).filter((f) => !f.waiver).length;
  const waivedCount = (latest?.findings || []).length - openCount;
  const providers = Object.entries(data.ratings).filter(([p]) => p !== SCAN_PROVIDER);

  return (
    <div className="space-y-[16px]">
      <section className="flex flex-wrap items-start justify-between gap-[16px] rounded-ds-card border border-ds-border bg-ds-surface p-[20px]">
        <div className="flex items-center gap-[16px]">
          <GradeBadge grade={latest?.grade} size="lg" />
          <div>
            {latest?.score != null ? (
              <p className="text-[20px] font-[600] text-ds-fg">{latest.score}<span className="text-[14px] font-normal text-ds-fg-muted"> / 100</span></p>
            ) : <p className="text-[16px] font-medium text-ds-fg-body">{latest ? 'Nothing answered' : 'Not scanned yet'}</p>}
            <p className="text-[12px] text-ds-fg-muted">
              {latest ? `Scanned ${fmtDate(latest.at)}` : 'Scan the supplier to see how its estate looks from outside.'}
              {delta !== null && delta !== 0 && (
                <span className={clsx('ml-2 font-medium', delta > 0 ? 'text-ds-success' : 'text-ds-danger')}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} since the scan before
                </span>
              )}
              {latest && latest.score !== latest.scanned_score && latest.scanned_score != null && (
                <span className="ml-2 text-ds-fg-muted">({latest.scanned_score} before waivers)</span>
              )}
            </p>
          </div>
          <Sparkline points={history} label="Outside-in score" />
        </div>
        <div className="max-w-sm space-y-2 text-right">
          {canScan && (
            <button type="button" onClick={() => scan.mutate()} disabled={data.running || scan.isPending || !data.domains.length}
              className="inline-flex items-center gap-1.5 rounded-ds-card bg-ds-primary px-3.5 py-2 text-[13px] font-medium text-ds-on-primary hover:bg-ds-primary-hover disabled:opacity-50">
              {data.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {data.running ? 'Scanning…' : 'Scan now'}
            </button>
          )}
          <p className="text-[12px] text-ds-fg-muted">
            {data.enabled ? `Scanned automatically every ${every} days.` : <>Scheduled scans are off; turn them on in <Link href="/vendor-risk/settings" className="text-ds-primary-text hover:underline">Settings</Link>.</>}
          </p>
          <p className="text-[12px] text-ds-fg-muted">
            {data.shodan ? 'Exposed services and known vulnerabilities come from Shodan.'
              : <>Add a Shodan key under <Link href="/admin/connectors" className="text-ds-primary-text hover:underline">Admin → Connectors</Link> to include exposed services and known vulnerabilities.</>}
          </p>
          {data.failed && <p className="text-[12px] text-ds-danger">The last scan failed: {data.failed.error || 'no reason given'}.</p>}
          {latest?.note && <p className="text-[12px] text-ds-warning">{latest.note}.</p>}
        </div>
      </section>

      <div className="grid gap-[16px] lg:grid-cols-3">
        <section className="rounded-ds-card border border-ds-border bg-ds-surface lg:col-span-2" aria-labelledby="oi-findings">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ds-border px-[16px] py-3">
            <h3 id="oi-findings" className="text-[13px] font-[600] text-ds-fg">Findings</h3>
            <div className="inline-flex rounded-ds-card border border-ds-border p-0.5 text-[12px]">
              {([['open', `Counting (${openCount})`], ['waived', `Waived (${waivedCount})`], ['all', 'All']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setShow(k)} aria-pressed={show === k}
                  className={clsx('rounded-ds-control px-2.5 py-1', show === k ? 'bg-ds-fg text-ds-on-primary' : 'text-ds-fg-body hover:bg-ds-surface-subtle')}>{label}</button>
              ))}
            </div>
          </div>
          {!latest ? (
            <p className="px-[16px] py-8 text-center text-[13px] text-ds-fg-muted">No scan yet.</p>
          ) : findings.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-[16px] py-8 text-[13px] text-ds-fg-muted">
              <ShieldCheck className="h-4 w-4 text-ds-success" /> {show === 'waived' ? 'Nothing waived.' : 'Nothing to report.'}
            </p>
          ) : (
            <ul className="divide-y divide-ds-border">
              {findings.map((f, i) => (
                <li key={`${f.key}-${f.host}-${i}`} className="flex flex-wrap items-start gap-[12px] px-[16px] py-3">
                  <span className={clsx('mt-0.5 inline-flex w-16 justify-center rounded-full border px-2 py-0.5 text-[12px] font-medium capitalize', SEVERITY_CLS[f.severity])}>
                    {f.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ds-fg">{f.title}</p>
                    <p className="text-[12px] text-ds-fg-muted">{f.host} · {f.category_label}{f.cvss ? ` · CVSS ${f.cvss}` : ''}</p>
                    {f.detail && <p className="mt-0.5 text-[12px] text-ds-fg-body">{f.detail}</p>}
                    {f.waiver && (
                      <p className="mt-1 text-[12px] text-ds-fg-muted">
                        Waived until {fmtDate(f.waiver.expires_on)}{f.waiver.by ? ` by ${f.waiver.by}` : ''}: “{f.waiver.reason}”
                      </p>
                    )}
                  </div>
                  <span className="text-[12px] tabular-nums text-ds-fg-muted">{f.waiver ? '0' : `−${f.points}`}</span>
                  {canWaive && (f.waiver ? (
                    <button type="button" onClick={() => revoke.mutate(f.waiver!.id)} className="rounded-ds-card border border-ds-border px-2.5 py-1 text-[12px] text-ds-fg-body hover:bg-ds-surface-subtle">Revoke</button>
                  ) : (
                    <button type="button" onClick={() => setWaiving(f)} className="rounded-ds-card border border-ds-border px-2.5 py-1 text-[12px] text-ds-fg-body hover:bg-ds-surface-subtle">Waive</button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-[16px]">
          {latest?.categories && (
            <section className="space-y-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]" aria-labelledby="oi-cats">
              <h3 id="oi-cats" className="text-[13px] font-[600] text-ds-fg">By area</h3>
              {Object.entries(data.categories).map(([k, label]) => <Meter key={k} label={label} value={latest.categories![k] ?? 100} />)}
              <p className="text-[12px] text-ds-fg-muted">Each finding takes off {data.points.critical} / {data.points.high} / {data.points.medium} / {data.points.low} points
                by severity, once per supplier; no one area takes off more than 40.</p>
            </section>
          )}
          {providers.length > 0 && (
            <section className="space-y-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]" aria-labelledby="oi-ratings">
              <h3 id="oi-ratings" className="text-[13px] font-[600] text-ds-fg">Ratings from providers</h3>
              {providers.map(([p, series]) => (
                <div key={p} className="flex items-center justify-between gap-[12px]">
                  <div>
                    <p className="text-[13px] text-ds-fg">{p}</p>
                    <p className="text-[12px] text-ds-fg-muted">{series[0].score} of 100{series[0].grade ? ` · ${series[0].grade}` : ''} · {fmtDate(series[0].at)}</p>
                    {riskCounts(series[0].risks) && (
                      <p className={clsx('text-[12px]', series[0].risks?.critical || series[0].risks?.high ? 'text-ds-danger' : 'text-ds-fg-muted')}>
                        Its risks: {riskCounts(series[0].risks)}
                      </p>
                    )}
                  </div>
                  <Sparkline points={[...series].reverse()} width={96} height={28} label={`${p} rating`} />
                </div>
              ))}
              <p className="text-[12px] text-ds-fg-muted">Shown on a 0 to 100 scale so providers compare.</p>
            </section>
          )}
          <Domains data={data} canEdit={canScan} onSaved={refresh} />
        </div>
      </div>

      {latest && latest.hosts.length > 0 && (
        <section className="overflow-x-auto rounded-ds-card border border-ds-border bg-ds-surface" aria-labelledby="oi-hosts">
          <h3 id="oi-hosts" className="border-b border-ds-border px-[16px] py-3 text-[13px] font-[600] text-ds-fg">Hosts looked at</h3>
          <table className="w-full text-[13px]">
            <thead className="bg-ds-surface-subtle text-left text-[12px] uppercase tracking-wide text-ds-fg-muted">
              <tr>
                <th className="px-[16px] py-2 font-medium">Host</th><th className="px-[16px] py-2 font-medium">Answers</th>
                <th className="px-[16px] py-2 font-medium">Certificate</th><th className="hidden px-[16px] py-2 font-medium md:table-cell">Server</th>
                <th className="hidden px-[16px] py-2 font-medium md:table-cell">Ports seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ds-border">
              {latest.hosts.map((h) => (
                <tr key={h.fqdn}>
                  <td className="px-[16px] py-2.5"><p className="font-medium text-ds-fg">{h.fqdn}</p><p className="text-[12px] text-ds-fg-muted">{h.ip}</p></td>
                  <td className="px-[16px] py-2.5 text-ds-fg-body">{h.live ? `${h.https ? 'HTTPS' : 'HTTP only'}${h.status_code ? ` · ${h.status_code}` : ''}` : 'No web answer'}
                    {h.cdn_waf && <p className="text-[12px] text-ds-fg-muted">Behind {h.cdn_waf}</p>}</td>
                  <td className="px-[16px] py-2.5 text-ds-fg-body">{h.tls_expires ? <>Until {fmtDate(h.tls_expires)}<p className="text-[12px] text-ds-fg-muted">{[h.tls_issuer, h.tls_version].filter(Boolean).join(' · ')}</p></> : '—'}</td>
                  <td className="hidden px-[16px] py-2.5 text-ds-fg-body md:table-cell">{h.server || '—'}</td>
                  <td className="hidden px-[16px] py-2.5 tabular-nums text-ds-fg-body md:table-cell">{h.ports.length ? h.ports.join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {latest && latest.technologies.length > 0 && (
        <section className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]" aria-labelledby="oi-tech">
          <h3 id="oi-tech" className="mb-1 text-[13px] font-[600] text-ds-fg">Technologies seen</h3>
          <p className="mb-3 text-[12px] text-ds-fg-muted">What its sites, mail and DNS records say it runs. A site can hide or misstate these, so absence proves nothing.</p>
          <div className="space-y-2">
            {Array.from(new Set(latest.technologies.map((t) => t.category))).map((cat) => (
              <div key={cat} className="flex flex-wrap items-baseline gap-1.5">
                <span className="w-36 shrink-0 text-[12px] text-ds-fg-muted">{cat}</span>
                {latest.technologies.filter((t) => t.category === cat).map((t) => {
                  const old = latest.findings.some((f) => f.key === `outdated:${t.name}` && !f.waiver);
                  return (
                    <Link key={t.name} href={`/vendor-risk/technology?q=${encodeURIComponent(t.name)}`} title={`Seen on ${t.hosts.join(', ')}`}
                      className={clsx('rounded-full border px-2 py-0.5 text-[12px] hover:border-ds-border-strong',
                        old ? 'border-ds-border-strong bg-ds-warning-soft text-ds-warning' : 'border-ds-border bg-ds-surface-subtle text-ds-fg-body')}>
                      {t.name}{t.versions.length ? ` ${t.versions.join(', ')}` : ''}{old ? ' · out of date' : ''}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.waivers.length > 0 && (
        <section className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]" aria-labelledby="oi-waivers">
          <h3 id="oi-waivers" className="mb-2 text-[13px] font-[600] text-ds-fg">Waivers</h3>
          <ul className="space-y-1.5 text-[13px]">
            {data.waivers.map((w) => (
              <li key={w.id} className="flex flex-wrap items-baseline gap-2">
                <span className={clsx('rounded-full border px-2 py-0.5 text-[12px]', w.state === 'active' ? 'border-ds-border-strong bg-ds-success-soft text-ds-success' : 'border-ds-border bg-ds-surface-subtle text-ds-fg-muted')}>{w.state}</span>
                <span className="text-ds-fg">{w.finding_key}{w.host ? ` on ${w.host}` : ''}</span>
                <span className="text-[12px] text-ds-fg-muted">until {fmtDate(w.expires_on)} · {w.by || '—'} · “{w.reason}”</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiving && <WaiveDialog vendorId={vendorId} finding={waiving} onClose={() => setWaiving(null)} onSaved={refresh} />}
    </div>
  );
}

function Domains({ data, canEdit, onSaved }: { data: VendorView; canEdit: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const save = useMutation({
    mutationFn: (domains: string[]) => vendorSecurityApi.setDomains(data.vendor.id, domains),
    onSuccess: () => { setDraft(''); onSaved(); },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });
  const website = data.domains.filter((d) => !data.extra_domains.includes(d));
  return (
    <section className="space-y-2 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]" aria-labelledby="oi-domains">
      <h3 id="oi-domains" className="flex items-center gap-1.5 text-[13px] font-[600] text-ds-fg"><Globe className="h-4 w-4 text-ds-fg-muted" /> Domains scanned</h3>
      {data.domains.length === 0 && <p className="text-[12px] text-ds-fg-muted">No website on record. Add a domain to scan this supplier.</p>}
      <ul className="flex flex-wrap gap-1.5">
        {website.map((d) => <li key={d} className="rounded-full border border-ds-border bg-ds-surface-subtle px-2 py-0.5 text-[12px] text-ds-fg-body" title="From the supplier's website">{d}</li>)}
        {data.extra_domains.map((d) => (
          <li key={d} className="inline-flex items-center gap-1 rounded-full border border-ds-border px-2 py-0.5 text-[12px] text-ds-fg-body">
            {d}
            {canEdit && (
              <button type="button" aria-label={`Remove ${d}`} onClick={() => save.mutate(data.extra_domains.filter((x) => x !== d))} className="text-ds-fg-muted hover:text-ds-danger">
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) save.mutate([...data.extra_domains, draft.trim()]); }}>
          <input aria-label="Another domain" className={clsx(input, 'py-1.5')} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. mail.supplier.com" />
          <button type="submit" disabled={!draft.trim() || save.isPending} className="inline-flex items-center gap-1 rounded-ds-card border border-ds-border px-2.5 text-[13px] text-ds-fg-body hover:bg-ds-surface-subtle disabled:opacity-50">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
      )}
    </section>
  );
}

function WaiveDialog({ vendorId, finding, onClose, onSaved }: { vendorId: number; finding: Finding; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const [scope, setScope] = useState<'host' | 'all'>('host');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(day(90));
  const save = useMutation({
    mutationFn: () => vendorSecurityApi.waive(vendorId, { finding_key: finding.key, host: scope === 'host' ? finding.host : null, reason, expires_on: until }),
    onSuccess: () => { onSaved(); toast({ type: 'success', title: 'Finding waived', message: `It stops counting until ${fmtDate(until)}.` }); onClose(); },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ds-fg p-[16px]" role="dialog" aria-modal="true" aria-label="Waive a finding"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="w-full max-w-md space-y-[16px] rounded-ds-card bg-ds-surface p-[20px] shadow-ds-pop" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div>
          <h2 className="text-[14px] font-[600] text-ds-fg">Waive this finding</h2>
          <p className="text-[12px] text-ds-fg-muted">{finding.title} · {finding.host}</p>
        </div>
        <div className="space-y-1.5" role="radiogroup" aria-label="Where it applies">
          {([['host', `Only on ${finding.host}`], ['all', 'On every host of this supplier']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-[13px] text-ds-fg-body">
              <input type="radio" name="waive-scope" checked={scope === k} onChange={() => setScope(k)} /> {label}
            </label>
          ))}
        </div>
        <label className="block text-[12px] font-medium text-ds-fg-body">Why it can be set aside
          <textarea className={clsx(input, 'mt-1')} rows={3} required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The supplier confirmed the fix ships on 1 November; compensating control in place" />
        </label>
        <label className="block text-[12px] font-medium text-ds-fg-body">Until
          <input type="date" className={clsx(input, 'mt-1')} required min={day(1)} max={day(366)} value={until} onChange={(e) => setUntil(e.target.value)} />
          <span className="mt-0.5 block font-normal text-ds-fg-muted">At most a year. It counts again the day after.</span>
        </label>
        {save.isError && <p className="text-[13px] text-ds-danger">{errText(save.error, 'Could not waive it')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-ds-card border border-ds-border px-3.5 py-2 text-[13px] text-ds-fg-body hover:bg-ds-surface-subtle">Cancel</button>
          <button type="submit" disabled={save.isPending || reason.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-ds-card bg-ds-primary px-3.5 py-2 text-[13px] font-medium text-ds-on-primary hover:bg-ds-primary-hover disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Waive
          </button>
        </div>
      </form>
    </div>
  );
}
