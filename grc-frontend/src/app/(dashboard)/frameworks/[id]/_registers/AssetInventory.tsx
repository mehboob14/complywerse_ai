'use client';

// The two asset-backed inventories of a journey: the PCI DSS Cardholder Data Inventory and the HIPAA ePHI Inventory. Each row IS a real IT asset flagged
// for the framework (CDE environment, ePHI environment); adding and editing use the same form as the Assets module (its AssetModal, with the flag set), so
// the two places always agree. The page is the same for both: a kind says which flag, which list and which words.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Database, ExternalLink, HeartPulse, Pencil, Plus, Trash2 } from 'lucide-react';
import { assetsApi, certificationsApi } from '@/lib/api';
import { AssetModal } from '@/app/(dashboard)/cyber-assurance/assets/AssetModal';
import { Button, EmptyState, Menu, RegisterTable, SectionCard, StatusPill, TitleLink, useConfirm, useReportedMutation, type MenuItem, type RegisterColumn } from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { EMPTY, UNASSIGNED, formatCount, statusLabel } from '@/lib/format';
import { assetCriticality } from '@/lib/statuses/frameworkRegisters';
import type { ITAsset } from '@/types';

type Kind = 'cde' | 'ephi';

interface Asset {
  id: number;
  name: string;
  asset_type?: string | null;
  location?: string | null;
  owner_name?: string | null;
  criticality?: string | null;
  status?: string | null;
  pci_dss?: Record<string, string | null> | null;
  hipaa?: Record<string, string | null> | null;
}

const KINDS: Record<Kind, {
  title: string; noun: string; flag: 'cde_environment' | 'ephi_environment'; queryKey: string; attrs: 'pci_dss' | 'hipaa'; dataKey: string; dataLabel: string;
  framework: string; info: string; emptyHint: string; Icon: typeof Database; read: () => Promise<{ data: unknown }>;
}> = {
  cde: {
    title: 'Cardholder Data Inventory', noun: 'CDE asset', flag: 'cde_environment', queryKey: 'cde-systems', attrs: 'pci_dss', dataKey: 'cardholder_data', dataLabel: 'Cardholder data',
    framework: 'PCI DSS', info: 'Each row is a real IT asset flagged as a CDE environment. Add and edit use the same form as the Assets module, so a change shows in both places.',
    emptyHint: 'Add the systems that store, process or transmit cardholder data.', Icon: Database, read: () => certificationsApi.getCDESystems(),
  },
  ephi: {
    title: 'ePHI Inventory', noun: 'ePHI asset', flag: 'ephi_environment', queryKey: 'ephi-systems', attrs: 'hipaa', dataKey: 'ephi_data', dataLabel: 'ePHI data',
    framework: 'HIPAA', info: 'Each row is a real IT asset flagged as an ePHI environment. Add and edit use the same form as the Assets module, so a change shows in both places.',
    emptyHint: 'Add the systems that store, process or transmit electronic protected health information.', Icon: HeartPulse, read: () => certificationsApi.getEPHISystems(),
  },
};

const dash = <span className="text-ds-fg-muted">{EMPTY}</span>;
const attr = (s: Asset, kind: Kind, key: string): string => {
  const v = s[KINDS[kind].attrs]?.[key];
  return v ? String(v) : '';
};
const plain = (text: string) => (text ? <span className="line-clamp-2 text-ds-body text-ds-fg-body" title={text.length > 60 ? text : undefined}>{text}</span> : dash);

interface Props { kind: Kind; frameworkName?: string }

export default function AssetInventory({ kind, frameworkName }: Props) {
  const k = KINDS[kind];
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [modal, setModal] = useState<{ asset: ITAsset | null } | null>(null);

  const list = useQuery({
    queryKey: [k.queryKey],
    queryFn: async () => (await k.read()).data as { systems: Asset[] },
  });
  const systems = list.data?.systems ?? [];
  const refresh = [[k.queryKey], ['assets'], ['cde-assets']] as const;

  const create = useReportedMutation({
    mutationFn: (payload: Parameters<typeof assetsApi.create>[0]) => assetsApi.create({ ...payload, [k.flag]: true }),
    success: { title: `${k.noun[0].toUpperCase()}${k.noun.slice(1)} added`, message: 'It is in the Assets module too.' },
    failure: "Couldn't add the asset",
    retryable: false,
    invalidate: refresh,
    onSuccess: () => setModal(null),
  });
  const update = useReportedMutation({
    mutationFn: (v: { id: number; data: Parameters<typeof assetsApi.create>[0] }) => assetsApi.update(v.id, v.data as never),
    success: { title: 'Asset updated', message: 'The Assets module shows the change too.' },
    failure: "Couldn't save the asset",
    invalidate: refresh,
    onSuccess: () => setModal(null),
  });
  const remove = useReportedMutation({
    mutationFn: (a: Asset) => assetsApi.delete(a.id),
    success: { title: 'Asset deleted', message: 'It is removed from the Assets module too.' },
    failure: "Couldn't delete the asset",
    invalidate: refresh,
  });
  // the form needs the whole asset: it is read when a row is opened
  const open = useReportedMutation({
    mutationFn: (id: number) => assetsApi.getById(id),
    failure: "Couldn't open the asset",
    onSuccess: (res) => setModal({ asset: res.data }),
  });

  const askDelete = async (a: Asset) => {
    if (await confirm({ title: `Delete ${a.name}?`, message: `It is removed from this inventory and from the Assets module. This can't be undone.`, confirmLabel: 'Delete asset', tone: 'danger' })) remove.mutate(a);
  };
  const menu = (a: Asset) => {
    const items: MenuItem[] = [
      { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => open.mutate(a.id), disabled: open.isPending },
      { key: 'assets', label: 'Open in Assets', icon: ExternalLink, onSelect: () => router.push(`/assets/${a.id}`) },
      { key: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => { void askDelete(a); } },
    ];
    return <Menu iconOnly label={`Actions for ${a.name}`} items={items} />;
  };

  const columns: RegisterColumn<Asset>[] = [
    {
      key: 'name', header: 'Asset or system', isRowHeader: true,
      cell: (a) => (
        <div className="min-w-0">
          <TitleLink href={`/assets/${a.id}`} title={a.name} />
          {(a.asset_type || a.location) && (
            <p className="text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{[a.asset_type ? statusLabel(a.asset_type) : '', a.location || ''].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      ),
    },
    { key: 'data', header: k.dataLabel, card: 'meta', cell: (a) => plain(attr(a, kind, k.dataKey)) },
    { key: 'encrypted', header: 'Encrypted', priority: 2, card: 'meta', cell: (a) => plain(attr(a, kind, 'encrypted')) },
    { key: 'retention', header: 'Retention', priority: 3, card: 'meta', cell: (a) => plain(attr(a, kind, 'retention')) },
    { key: 'owner', header: 'Owner', priority: 2, card: 'meta', cell: (a) => (a.owner_name ? <span className="text-ds-body text-ds-fg-body">{a.owner_name}</span> : <span className="text-ds-body text-ds-fg-muted">{UNASSIGNED}</span>) },
    { key: 'criticality', header: 'Criticality', card: 'meta', cell: (a) => (a.criticality ? <StatusPill size="sm" tone={assetCriticality.tone(a.criticality)} label={assetCriticality.label(a.criticality)} /> : dash) },
    { key: 'assessment', header: 'Assessment', priority: 3, card: 'meta', cell: (a) => plain(attr(a, kind, 'assessment')) },
    { key: '__actions', header: 'Actions', align: 'right', card: 'hide', width: 'w-[64px]', cell: menu },
  ];

  const failure = list.error ? { message: safeDetail(apiErrorText(list.error, `The ${k.title.toLowerCase()} couldn't be loaded.`)), onRetry: () => { void list.refetch(); } } : null;
  const add = () => setModal({ asset: null });

  return (
    <SectionCard
      id={`inventory-${kind}`}
      title={k.title}
      info={`${k.noun[0].toUpperCase()}${k.noun.slice(1)}s in scope for ${frameworkName || k.framework}. ${k.info}`}
      meta={list.isLoading || failure ? undefined : `${formatCount(systems.length)} ${systems.length === 1 ? 'asset' : 'assets'}`}
      actions={(
        <>
          <Button href="/assets" rightIcon={<ExternalLink aria-hidden />}>Open Assets</Button>
          <Button variant="primary" leftIcon={<Plus aria-hidden />} disabled={list.isLoading || !!failure} onClick={add}>{`Add ${k.noun}`}</Button>
        </>
      )}
    >
      <RegisterTable
        caption={k.title}
        columns={columns}
        rows={systems}
        getRowId={(a) => a.id}
        loading={list.isLoading}
        error={failure}
        onRowActivate={(a) => open.mutate(a.id)}
        cardTitle={(a) => a.name}
        cardActions={menu}
        empty={<EmptyState kind="firstUse" bare icon={k.Icon} title={`No ${k.noun}s yet`} description={k.emptyHint} action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={add}>{`Add ${k.noun}`}</Button>} />}
      />
      {modal && (
        <AssetModal
          initialData={modal.asset}
          isLoading={create.isPending || update.isPending}
          {...(kind === 'cde' ? { forceCde: true } : { forceEphi: true })}
          onClose={() => setModal(null)}
          onSave={(payload) => { if (modal.asset) update.mutate({ id: modal.asset.id, data: payload }); else create.mutate(payload); }}
        />
      )}
      {confirmDialog}
    </SectionCard>
  );
}
