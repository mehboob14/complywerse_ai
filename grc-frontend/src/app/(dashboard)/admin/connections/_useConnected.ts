'use client';

// The reads of Connected systems: one query per kind (each keeps its own error, so a kind that could not be read is said and never drawn as "nothing connected") and the lists the
// connect catalogue and the forms need. The query keys are the ones the older pages used. Credentials are not in any of these answers: the servers never return them.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { automationApi, cloudConnectorsApi, connectorsApi, integrationsApi, type CloudConnector, type ConnectorProviderMeta, type ConnectorRow } from '@/lib/api';
import { canRetry, statusOf } from '@/components/ui/ds/reportOutcome';
import type { Connector } from '../evidence-collectors/connectionsModel';
import {
  catalogueOf, cloudRows, evidenceRows, scannerRows, toolRows, type CatalogueEntry, type CloudRaw, type ConnectedRow, type Kind, type ScannerRaw, type ToolRaw,
} from './connectedModel';

/** What GET /integrations/connections returns for a scanner (the fields the manage sheet shows). `has_*` say a credential is saved; the credential itself is never returned. */
export interface ScannerFull extends ScannerRaw {
  tenant_id?: number;
  auth_method?: string;
  credential_env_prefix?: string | null;
  username?: string | null;
  has_password?: boolean;
  has_stored_credentials?: boolean;
  sync_schedule: string;
  scanner_writeback?: boolean;
  last_sync_stats: Record<string, unknown> | null;
  created_at: string | null;
}

export interface SyncRecord {
  id: number; sync_type: string; started_at: string; completed_at: string | null; duration_ms: number | null; status: string;
  assets_new: number; assets_updated: number; vulns_new: number; vulns_updated: number; errors_count: number;
}

export interface CatalogueData {
  connectors: Connector[];
  counts: { total: number; supported: number; connected: number; catalog: number };
}

const retry = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

export interface ConnectedData {
  rows: ConnectedRow[];
  scanners: ScannerFull[];
  cloud: CloudConnector[];
  tools: ConnectorRow[];
  evidence: Connector[];
  toolProviders: ConnectorProviderMeta[];
  cloudProviders: Array<{ provider: string; label: string; framework?: string }>;
  entries: CatalogueEntry[];
  /** the kinds whose list could not be read, with the error (a 403 reads differently from a failure) */
  failed: Partial<Record<Kind, unknown>>;
  /** the saved credentials of cloud connectors / tools are stored without encryption on this server */
  unencrypted: boolean;
  loading: boolean;
  /** every read (the four lists and the two provider catalogues) has answered, well or not: what a link into the page can be matched against */
  ready: boolean;
  retryKind: (kind: Kind) => void;
  refetchAll: () => void;
}

export function useConnected(): ConnectedData {
  const scannersQ = useQuery({ queryKey: ['connections'], queryFn: () => integrationsApi.listConnections().then((r) => (r.data?.connections ?? []) as ScannerFull[]), retry });
  const cloudQ = useQuery({ queryKey: ['cloud-connectors'], queryFn: () => cloudConnectorsApi.list().then((r) => r.data), retry });
  const toolsQ = useQuery({ queryKey: ['connectors', 'list'], queryFn: () => connectorsApi.list().then((r) => r.data.items), retry });
  const catalogQ = useQuery({ queryKey: ['soc2-catalog'], queryFn: () => automationApi.listCatalog().then((r) => r.data as CatalogueData), retry });
  const cloudProvidersQ = useQuery({ queryKey: ['cloud-connector-providers'], queryFn: () => cloudConnectorsApi.listProviders().then((r) => r.data), retry });
  const toolProvidersQ = useQuery({ queryKey: ['connectors', 'providers'], queryFn: () => connectorsApi.listProviders().then((r) => r.data), retry });

  const scanners = useMemo(() => scannersQ.data ?? [], [scannersQ.data]);
  const cloud = useMemo(() => cloudQ.data ?? [], [cloudQ.data]);
  const tools = useMemo(() => toolsQ.data ?? [], [toolsQ.data]);
  const evidence = useMemo(() => catalogQ.data?.connectors ?? [], [catalogQ.data]);
  const toolProviders = useMemo(() => toolProvidersQ.data?.providers ?? [], [toolProvidersQ.data]);
  const cloudProviders = useMemo(() => cloudProvidersQ.data?.providers ?? [], [cloudProvidersQ.data]);

  const rows = useMemo(
    () => [...scannerRows(scanners), ...cloudRows(cloud as CloudRaw[]), ...toolRows(tools as ToolRaw[]), ...evidenceRows(evidence)],
    [scanners, cloud, tools, evidence],
  );
  const entries = useMemo(
    () => catalogueOf({ cloudProviders, toolProviders: toolProviders.map((p) => ({ provider: p.provider, label: p.label, category: p.category, description: p.description })), evidence, connected: rows }),
    [cloudProviders, toolProviders, evidence, rows],
  );

  const failed: Partial<Record<Kind, unknown>> = {};
  if (scannersQ.isError && !scannersQ.data) failed.scanners = scannersQ.error;
  if (cloudQ.isError && !cloudQ.data) failed.cloud = cloudQ.error;
  if (toolsQ.isError && !toolsQ.data) failed.tools = toolsQ.error;
  if (catalogQ.isError && !catalogQ.data) failed.evidence = catalogQ.error;

  const retryKind = (kind: Kind) => { void ({ scanners: scannersQ, cloud: cloudQ, tools: toolsQ, evidence: catalogQ }[kind].refetch()); };
  return {
    rows, scanners, cloud, tools, evidence, toolProviders, cloudProviders, entries, failed,
    unencrypted: cloudProvidersQ.data?.encryption_ready === false || toolProvidersQ.data?.encryption_enabled === false,
    loading: scannersQ.isPending || cloudQ.isPending || toolsQ.isPending || catalogQ.isPending,
    ready: !(scannersQ.isPending || cloudQ.isPending || toolsQ.isPending || catalogQ.isPending || cloudProvidersQ.isPending || toolProvidersQ.isPending),
    retryKind,
    refetchAll: () => { void scannersQ.refetch(); void cloudQ.refetch(); void toolsQ.refetch(); void catalogQ.refetch(); },
  };
}

/** A list that could not be read, in a sentence: "no access" for a refusal, else the server's own words are the page's job (errorMessage). */
export const wasRefused = (error: unknown): boolean => statusOf(error) === 403;
