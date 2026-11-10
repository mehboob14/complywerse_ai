'use client';

// The four views of Monitoring > Dependencies. Technology: what suppliers run, from outside, and who runs a product (or shows a CVE). Shared platforms: the platforms several suppliers rely on,
// where one failure is several failures for us. Shared vulnerabilities: known-exploited flaws that hit more than one supplier at once. Not in the register: suppliers our own discovery found that
// nobody has recorded. Only the view that is open asks for its data; a failed read says so with a Retry (never "none found"); every change is reported when the server has answered.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bug, EyeOff, FileText, Layers, Radar, Trash2 } from 'lucide-react';
import {
  Button, Checkbox, ChipList, DebouncedSearch, EmptyState, ErrorState, FilterChips, FormField, Menu, Notice, RegisterTable, Sheet, SkeletonRows, StatusPill, TextInput,
  useConfirm, useReportedMutation, type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { usePermissions } from '@/hooks/usePermissions';
import { tpraApi, vendorTechApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { signalSeverity } from '@/lib/statuses/vendorMonitoring';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import {
  DISMISS_SAYS, aliasSays, cveOf, dependantLabel, foundBy, requestHref, sharedFirst,
  type Alias, type Catalogue, type Platform, type Shadow, type Shows, type SharedVuln, type Tech, type Who,
} from './dependenciesModel';

const MUTED = 'text-ds-fg-muted';
const LINK = linkClasses({ tone: 'text', size: 'label' });
const retry = (e: unknown, r?: () => void) => (canRetry(e) && r ? r : undefined);
/** A list of chips in a table cell: capped, so a long name is cut inside its chip (full name on hover) instead of widening the column past the page. */
const Cap = ({ children }: { children: React.ReactNode }) => <div className="min-w-0 max-w-[440px]">{children}</div>;
const Tier = ({ tier }: { tier: string | null }) => (tier ? <StatusPill size="sm" {...statusPill(vendorTier, tier)} /> : null);
const vendorHref = (id: number, tab?: string) => `/vendor-risk/vendors/${id}${tab ? `?${tab}` : ''}`;

function Failed({ error, title, onRetry }: { error: unknown; title: string; onRetry: () => void }) {
  return <ErrorState title={title} message={errorMessage(error)} onRetry={retry(error, onRetry)} />;
}

// ── Technology ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function TechnologyView({ q, category, onQuery, onCategory }: { q: string; category: string; onQuery: (v: string) => void; onCategory: (v: string) => void }) {
  const cve = cveOf(q);
  const [picked, setPicked] = useState<string | null>(null);
  const cat = useQuery({
    queryKey: ['tprm-tech', cve ? '' : q, category],
    queryFn: async () => (await vendorTechApi.catalogue({ q: (!cve && q) || undefined, category: category || undefined })).data as Catalogue,
    ...TPRM_QUERY_OPTS,
  });
  const shows = useQuery({
    queryKey: ['tprm-tech-cve', cve],
    queryFn: async () => (await vendorTechApi.whoShows(cve as string)).data as Shows,
    enabled: !!cve,
    ...TPRM_QUERY_OPTS,
  });
  const chips: FilterChip[] = [{ key: '', label: 'All', active: category === '' }, ...(cat.data?.categories ?? []).map((c) => ({ key: c, label: c, active: category === c }))];

  return (
    <div className="flex flex-col gap-[12px]">
      <DebouncedSearch value={q} onSearch={onQuery} label="Search technologies or a CVE" placeholder="e.g. WordPress, AWS, Microsoft 365 or CVE-2024-3400" loading={cat.isFetching || shows.isFetching} className="max-w-[560px]" />
      {cve ? (
        <>
          {shows.isError && <Failed error={shows.error} title="Couldn't check who shows this CVE" onRetry={() => { void shows.refetch(); }} />}
          {!shows.isError && (
            <RegisterTable<Shows['items'][number]>
              caption={`Suppliers whose latest scan shows ${cve}`}
              loading={shows.isPending}
              rows={shows.data?.items ?? []}
              getRowId={(r) => r.vendor.id}
              cardTitle={(r) => <Link href={vendorHref(r.vendor.id, 'tab=outside-in')} className={LINK}>{r.vendor.name}</Link>}
              columns={[
                { key: 'v', header: 'Supplier', isRowHeader: true, card: 'hide', cell: (r) => <Link href={vendorHref(r.vendor.id, 'tab=outside-in')} className={LINK}>{r.vendor.name}</Link> },
                { key: 't', header: 'Tier', card: 'meta', cell: (r) => <Tier tier={r.vendor.tier} /> },
                { key: 's', header: 'Severity', card: 'meta', cell: (r) => <StatusPill size="sm" {...statusPill(signalSeverity, r.severity)} /> },
                { key: 'h', header: 'On', card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.hosts.join(', ') || '—'}{r.cvss ? ` · CVSS ${r.cvss}` : ''}</span> },
                { key: 'a', header: 'Scanned', card: 'meta', priority: 2, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.at)}{r.waived ? ' · waived' : ''}</span> },
              ]}
              empty={<EmptyState kind="noMatches" bare title={`No scanned supplier shows ${cve}`} description={`${shows.data?.scanned ?? 0} scanned. Vulnerabilities are read from Shodan, so a supplier is covered only when a Shodan key is connected.`} />}
            />
          )}
        </>
      ) : (
        <>
          {(cat.data?.categories.length ?? 0) > 0 && <FilterChips label="Filter by category" chips={chips} onToggle={(k) => onCategory(k === category ? '' : k)} overflow="wrap" />}
          {cat.isError ? <Failed error={cat.error} title="Couldn't load the technologies" onRetry={() => { void cat.refetch(); }} /> : (
            <RegisterTable<Tech>
              caption="Technologies suppliers run"
              loading={cat.isPending}
              rows={cat.data?.items ?? []}
              getRowId={(t) => t.name}
              onRowActivate={(t) => setPicked(t.name)}
              cardTitle={(t) => <span className="font-[600] text-ds-fg">{t.name}</span>}
              footer={cat.data ? <p className={`m-0 px-[4px] pt-[8px] text-ds-label ${MUTED}`}>From the latest scan of {formatCount(cat.data.scanned)} of {formatCount(cat.data.suppliers)} suppliers in use.</p> : undefined}
              columns={[
                { key: 'n', header: 'Technology', isRowHeader: true, card: 'hide', cell: (t) => <span className="font-[600] text-ds-fg">{t.name}</span> },
                { key: 'c', header: 'Category', card: 'meta', cell: (t) => <span className="text-ds-body text-ds-fg-body">{t.category}</span> },
                { key: 's', header: 'Suppliers', align: 'right', card: 'meta', cell: (t) => <span className="tabular-nums text-ds-body text-ds-fg">{t.vendors}</span> },
                { key: 'k', header: 'Critical', align: 'right', priority: 2, card: 'meta', cell: (t) => <span className={`tabular-nums text-ds-body ${t.critical ? 'font-[600] text-ds-fg' : MUTED}`}>{t.critical}</span> },
                { key: 'v', header: 'Versions seen', priority: 3, card: 'hide', cell: (t) => <Cap><ChipList items={t.versions} label="versions" shown={3} /></Cap> },
              ]}
              empty={(
                <EmptyState
                  kind={cat.data?.scanned ? 'noMatches' : 'firstUse'} bare
                  title={cat.data?.scanned ? (q ? `Nothing seen matches “${q}”` : 'Nothing seen yet') : 'No supplier has been scanned yet'}
                  description={cat.data?.scanned ? undefined : 'Turn on outside-in scans in Settings, or scan one supplier from its Outside-in tab.'}
                  action={q && !cve ? <Button onClick={() => setPicked(q)}>{`Check fourth parties for “${q}”`}</Button> : <Link href="/vendor-risk/settings" className={LINK}>Open Settings</Link>}
                />
              )}
            />
          )}
        </>
      )}
      <WhoRuns name={picked} onClose={() => setPicked(null)} />
    </div>
  );
}

function WhoRuns({ name, onClose }: { name: string | null; onClose: () => void }) {
  const [last, setLast] = useState<string | null>(name);
  if (name && last !== name) setLast(name);
  const shown = name ?? last;
  const q = useQuery({ queryKey: ['tprm-tech-who', shown], queryFn: async () => (await vendorTechApi.whoRuns(shown as string)).data as Who, enabled: !!name, retry: 1 });
  return (
    <Sheet open={!!name} onClose={onClose} title={`Who runs ${shown ?? ''}`} subtitle={q.data?.platform && shown && q.data.platform.toLowerCase() !== shown.toLowerCase() ? `Counted as part of ${q.data.platform}` : undefined}>
      {q.isPending && <SkeletonRows rows={4} columns={2} label="Looking for the suppliers" />}
      {q.isError && <ErrorState compact title="Couldn't check who runs it" message={errorMessage(q.error)} onRetry={retry(q.error, () => { void q.refetch(); })} />}
      {q.data && q.data.items.length === 0 && <p className={`m-0 text-ds-body ${MUTED}`}>No supplier in use is seen running it, or has it recorded as a fourth party.</p>}
      {q.data && q.data.items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
          {q.data.items.map((r) => (
            <li key={r.vendor.id} className="flex flex-col gap-[6px] rounded-ds-card border border-ds-border p-[12px]">
              <span className="flex flex-wrap items-center gap-[8px]"><Link href={vendorHref(r.vendor.id, 'tab=outside-in')} className={`${LINK} font-[600]`}>{r.vendor.name}</Link><Tier tier={r.vendor.tier} /></span>
              <ul className="m-0 flex list-none flex-col gap-[4px] p-0 text-ds-label text-ds-fg-body">
                {r.seen.map((s) => (
                  <li key={s.name}>Seen on its estate: {s.name}{s.versions.length ? ` ${s.versions.join(', ')}` : ''}{s.hosts.length ? ` on ${s.hosts.slice(0, 3).join(', ')}${s.hosts.length > 3 ? ` and ${s.hosts.length - 3} more` : ''}` : ''}<span className={MUTED}> · {formatDate(s.at)}</span></li>
                ))}
                {r.fourth_parties.map((f) => <li key={f.name}>Recorded fourth party: {f.name}{f.service ? ` (${f.service})` : ''}{f.critical ? ' · critical dependency' : ''}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ── Shared platforms (and the names that fold them) ──────────────────────────────────────────────────────────────────────

export function PlatformsView({ canEdit }: { canEdit: boolean }) {
  const [naming, setNaming] = useState(false);
  const q = useQuery({ queryKey: ['tprm-concentration'], queryFn: async () => ((await tpraApi.concentration(2)).data?.platforms ?? []) as Platform[], ...TPRM_QUERY_OPTS });
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className={`m-0 max-w-[640px] text-ds-body ${MUTED}`}>Where several suppliers rely on the same platform, one failure there is several failures for us. Built from each supplier&apos;s fourth parties; add them on a supplier&apos;s Dependencies tab.</p>
        <Button leftIcon={<Layers aria-hidden />} onClick={() => setNaming(true)}>Platform names</Button>
      </div>
      {q.isError ? <Failed error={q.error} title="Couldn't count the shared platforms" onRetry={() => { void q.refetch(); }} /> : (
        <RegisterTable<Platform>
          caption="Platforms several suppliers rely on"
          loading={q.isPending}
          rows={q.data ?? []}
          getRowId={(p) => p.platform}
          cardTitle={(p) => <span className="font-[600] text-ds-fg">{p.platform}</span>}
          columns={[
            {
              key: 'p', header: 'Platform', isRowHeader: true, card: 'hide', width: 'w-[240px]',
              cell: (p) => (
                <span className="flex flex-col">
                  <span className="break-words font-[600] text-ds-fg">{p.platform}</span>
                  {p.direct_vendor_id && <Link href={vendorHref(p.direct_vendor_id)} className={LINK}>Also a direct supplier</Link>}
                </span>
              ),
            },
            { key: 'n', header: 'Suppliers', align: 'right', card: 'meta', width: 'w-[96px]', cell: (p) => <span className="tabular-nums text-ds-body text-ds-fg">{p.vendor_count}</span> },
            { key: 'c', header: 'Critical', align: 'right', card: 'meta', width: 'w-[88px]', cell: (p) => <span className={`tabular-nums text-ds-body ${p.critical_count ? 'font-[600] text-ds-danger' : MUTED}`}>{p.critical_count}</span> },
            { key: 'v', header: 'Who relies on it', card: 'meta', cell: (p) => <Cap><ChipList items={p.vendors.map((v) => ({ label: dependantLabel(v), href: vendorHref(v.id, 'tab=dependencies') }))} label="suppliers" shown={3} /></Cap> },
          ]}
          empty={<EmptyState kind="firstUse" bare icon={Layers} title="No platform is shared yet" description="No platform is relied on by two or more suppliers. Record a supplier's fourth parties on its Dependencies tab." />}
        />
      )}
      <PlatformNames open={naming} onClose={() => setNaming(false)} canEdit={canEdit} />
    </div>
  );
}

function PlatformNames({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState({ alias: '', platform: '', excluded: false });
  const q = useQuery({ queryKey: ['tprm-platform-aliases'], queryFn: async () => ((await tpraApi.platformAliases()).data?.items ?? []) as Alias[], enabled: open, ...TPRM_QUERY_OPTS });
  const stale = [['tprm-platform-aliases'], ['tprm-concentration'], ['tprm-shadow-suppliers']];
  const add = useReportedMutation({
    mutationFn: async () => tpraApi.addPlatformAlias({ alias: form.alias.trim(), platform: form.excluded ? undefined : form.platform.trim() || undefined, excluded: form.excluded }),
    success: 'The name is saved. Counts use it from now on.', failure: "Couldn't save the name", invalidate: stale, retryable: false, onSuccess: () => setForm({ alias: '', platform: '', excluded: false }),
  });
  const remove = useReportedMutation({ mutationFn: async (a: Alias) => tpraApi.removePlatformAlias(a.id), success: 'The name is removed', failure: "Couldn't remove the name", invalidate: stale });
  const ask = async (a: Alias) => {
    const yes = await confirm({ title: 'Remove this name?', message: `${aliasSays(a)} will stop applying, and the counts change with it.`, confirmLabel: 'Remove', tone: 'danger' });
    if (yes) remove.mutate(a);
  };
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Platform names" subtitle="One platform, many spellings" dirty={form.alias.trim() !== ''}>
        <div className="flex flex-col gap-[16px]">
          <p className={`m-0 text-ds-body ${MUTED}`}>Common spellings are folded already (“Amazon Web Services”, “AWS” and “amazon aws” are one platform). Add your own, or exclude a generic name so it never counts.</p>
          {q.isPending && <SkeletonRows rows={3} columns={2} label="Loading the names" />}
          {q.isError && <ErrorState compact title="Couldn't load the names" message={errorMessage(q.error)} onRetry={retry(q.error, () => { void q.refetch(); })} />}
          {q.data && q.data.length === 0 && <p className={`m-0 text-ds-body ${MUTED}`}>No names of your own yet.</p>}
          {q.data && q.data.length > 0 && (
            <ul className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
              {q.data.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-[8px] py-[6px] text-ds-body text-ds-fg">
                  <span className="min-w-0 break-words">{aliasSays(a)}</span>
                  {canEdit && <Button size="sm" variant="ghost" leftIcon={<Trash2 aria-hidden />} aria-label={`Remove ${a.alias}`} onClick={() => { void ask(a); }}>Remove</Button>}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (form.alias.trim()) add.mutate(); }}>
              <FormField label="Name as written"><TextInput value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} maxLength={120} /></FormField>
              {!form.excluded && <FormField label="Platform it means" optional><TextInput value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} maxLength={120} /></FormField>}
              <Checkbox label="Leave this name out of the counts" checked={form.excluded} onChange={(e) => setForm({ ...form, excluded: e.target.checked })} />
              <div><Button type="submit" variant="primary" loading={add.isPending} disabled={!form.alias.trim()}>Add the name</Button></div>
            </form>
          )}
        </div>
      </Sheet>
      {confirmDialog}
    </>
  );
}

// ── Shared vulnerabilities ───────────────────────────────────────────────────────────────────────────────────────────────

export function VulnerabilitiesView() {
  const q = useQuery({ queryKey: ['tprm-shared-vulns'], queryFn: async () => ((await tpraApi.sharedVulnerabilities(90)).data?.vulnerabilities ?? []) as SharedVuln[], ...TPRM_QUERY_OPTS });
  const rows = sharedFirst(q.data ?? []);
  return (
    <div className="flex flex-col gap-[12px]">
      <p className={`m-0 max-w-[640px] text-ds-body ${MUTED}`}>Known-exploited vulnerabilities in the products watched on each supplier&apos;s Dependencies tab, over the last 90 days. The ones that hit more than one supplier come first.</p>
      {q.isError ? <Failed error={q.error} title="Couldn't load the shared vulnerabilities" onRetry={() => { void q.refetch(); }} /> : (
        <RegisterTable<SharedVuln>
          caption="Known-exploited vulnerabilities across suppliers"
          loading={q.isPending}
          rows={rows}
          getRowId={(v) => v.cve}
          cardTitle={(v) => <span className="font-[600] text-ds-fg">{v.title || v.cve}</span>}
          columns={[
            { key: 'v', header: 'Vulnerability', isRowHeader: true, card: 'hide', width: 'w-[280px]', cell: (v) => <span className="flex flex-col"><span className="font-[600] text-ds-fg">{v.title || v.cve}</span>{v.title && <span className={`text-ds-label ${MUTED}`}>{v.cve}</span>}</span> },
            { key: 's', header: 'Severity', card: 'meta', cell: (v) => <StatusPill size="sm" {...statusPill(signalSeverity, v.severity)} /> },
            { key: 'n', header: 'Suppliers', align: 'right', card: 'meta', cell: (v) => <span className={`tabular-nums text-ds-body ${v.vendors.length > 1 ? 'font-[600] text-ds-danger' : 'text-ds-fg'}`}>{v.vendors.length}</span> },
            { key: 'w', header: 'Who is affected', card: 'meta', cell: (v) => <Cap><ChipList items={v.vendors.map((x) => ({ label: x.name, href: vendorHref(x.id, 'stage=monitoring') }))} label="suppliers" shown={3} /></Cap> },
            { key: 'd', header: 'Seen', priority: 2, card: 'meta', cell: (v) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(v.occurred_at)}</span> },
          ]}
          empty={<EmptyState kind="firstUse" bare icon={Bug} title="None in the last 90 days" description="No known-exploited vulnerability has been seen in the products watched on suppliers." />}
        />
      )}
    </div>
  );
}

// ── Not in the register ──────────────────────────────────────────────────────────────────────────────────────────────────

export function UnregisteredView({ canRequest, canEdit }: { canRequest: boolean; canEdit: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const q = useQuery({ queryKey: ['tprm-shadow-suppliers'], queryFn: async () => ((await tpraApi.shadowSuppliers(50)).data?.items ?? []) as Shadow[], ...TPRM_QUERY_OPTS });
  const dismiss = useReportedMutation({
    mutationFn: async (s: Shadow) => tpraApi.addPlatformAlias({ alias: s.name, excluded: true }),
    success: (_d, s) => `${s.name} is hidden from this list`, failure: "Couldn't hide it", invalidate: [['tprm-shadow-suppliers'], ['tprm-platform-aliases'], ['tprm-concentration']],
  });
  const ask = async (s: Shadow) => {
    const yes = await confirm({ title: `${s.name} is not a supplier we manage?`, message: DISMISS_SAYS, confirmLabel: 'Hide it' });
    if (yes) dismiss.mutate(s);
  };
  const router = useRouter();
  // a phone's card has no column for the button, so its menu holds both steps; the table keeps Request vendor as a button beside the menu
  const menu = (s: Shadow, withRequest = false) => {
    const items: MenuItem[] = [
      { key: 'request', label: 'Request vendor', icon: FileText, hidden: !withRequest || !canRequest, onSelect: () => router.push(requestHref(s.name)) },
      { key: 'hide', label: 'Not a supplier we manage', icon: EyeOff, hidden: !canEdit, onSelect: () => { void ask(s); } },
    ];
    return items.some((i) => !i.hidden) ? <Menu iconOnly label={`Actions for ${s.name}`} items={items} /> : null;
  };
  return (
    <div className="flex flex-col gap-[12px]">
      <p className={`m-0 max-w-[640px] text-ds-body ${MUTED}`}>Found by our own discovery: publishers of software installed on our estate, vendors of identified software, and the vendor named on application, cloud and third-party assets. None of them is in the vendor register yet.</p>
      {q.isError ? <Failed error={q.error} title="Couldn't load the suppliers we have no record of" onRetry={() => { void q.refetch(); }} /> : (
        <RegisterTable<Shadow>
          caption="Suppliers we have no record of"
          loading={q.isPending}
          rows={q.data ?? []}
          getRowId={(s) => s.name}
          cardTitle={(s) => <span className="font-[600] text-ds-fg">{s.name}</span>}
          cardActions={(s) => menu(s, true)}
          columns={[
            { key: 'n', header: 'Supplier found', isRowHeader: true, card: 'hide', width: 'w-[240px]', cell: (s) => <span className="font-[600] text-ds-fg">{s.name}</span> },
            { key: 'f', header: 'Found by', card: 'meta', cell: (s) => <span className="text-ds-body text-ds-fg-body">{foundBy(s)}</span> },
            { key: 'p', header: 'Products', priority: 2, card: 'meta', cell: (s) => <Cap><ChipList items={s.products} label="products" shown={2} /></Cap> },
            {
              key: 'a', header: 'Next step', width: 'w-[260px]', card: 'hide',
              cell: (s) => (
                <span className="flex flex-wrap items-center gap-[8px]">
                  {canRequest && <Button size="sm" variant="primary" href={requestHref(s.name)} leftIcon={<FileText aria-hidden />}>Request vendor</Button>}
                  {menu(s)}
                </span>
              ),
            },
          ]}
          empty={<EmptyState kind="firstUse" bare icon={Radar} title="Every supplier discovery finds is in the register" description="Nothing to add: the suppliers named on assets and installed software are all recorded." />}
        />
      )}
      {canRequest && <Notice tone="info">Request vendor opens Intake with the name, so the supplier is assessed before it is recorded.</Notice>}
      {confirmDialog}
    </div>
  );
}
