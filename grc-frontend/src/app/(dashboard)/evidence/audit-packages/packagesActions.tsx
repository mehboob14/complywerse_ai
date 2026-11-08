'use client';

/**
 * The requests and actions of the Audit packages tab: the list, a package with its files and its log, the frameworks and the approved files a package can take, and what a person can do
 * (create, delete, finalize, export, download, legal hold on and off, add / remove / move a file). Each action says what happened when the server has answered (useReportedMutation) and
 * the ones that cannot be taken back ask first, in words that say what will happen (useConfirm): there are no native dialogs here. Export downloads the zip it built, the way it always
 * said it would; every download is a row of the package's access log. The rules (which step a package may take) are packagesModel.ts; the server decides them in the end.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { truncate } from '@/lib/format';
import { RETRY_AFTER, retryRead } from '../_library/libraryData';
import type { EvidenceItem } from '../_workspace/evidenceModel';
import { createPayload, downloadName, swapPlan, type CreateForm, type PackageDetail, type PackageLog, type PackageRow } from './packagesModel';

const BASE = '/evidence-mgmt/audit-packages';
export const LIST_KEY = ['audit-packages', 'list'] as const;
export const DETAIL_KEY = 'audit-package-detail';
export const LOG_KEY = 'audit-package-log';
const REFRESH = [['audit-packages'], [DETAIL_KEY], [LOG_KEY]] as const;
/** The most packages the tab loads in one request; the page says so when more exist. */
export const LIST_LIMIT = 200;

export interface PackageList { items: PackageRow[]; total: number }
export interface Framework { id: number; name: string; short_code?: string }

export function usePackages() {
  return useQuery({
    queryKey: [...LIST_KEY],
    queryFn: async () => (await apiClient.get(BASE, { params: { limit: LIST_LIMIT } })).data as PackageList,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

export function usePackage(id: number | null) {
  return useQuery({
    queryKey: [DETAIL_KEY, id],
    queryFn: async () => (await apiClient.get(`${BASE}/${id}`)).data as PackageDetail,
    enabled: id !== null,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

export function usePackageLog(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: [LOG_KEY, id],
    queryFn: async () => (await apiClient.get(`${BASE}/${id}/access-log`, { params: { limit: 100 } })).data as { items: PackageLog[]; total: number },
    enabled: enabled && id !== null,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

export function useFrameworks(enabled: boolean) {
  return useQuery({
    queryKey: ['frameworks-list'],
    queryFn: async () => (await apiClient.get('/frameworks')).data as Framework[],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

/** The approved files a package can take, found by the server (up to 50 for the words typed; the sheet says how many there are in all). */
export function useApprovedFiles(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ['available-evidence', search],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items', { params: { lean: 1, status: 'approved', limit: 50, ...(search ? { search } : {}) } })).data as { items: EvidenceItem[]; total: number },
    enabled,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

function save(data: BlobPart, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function usePackageActions(onGone: (id: number) => void, onCreated: (id: number) => void) {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [exporting, setExporting] = useState<number | null>(null);
  const name = (p: { name: string }) => truncate(p.name, 60).text;

  const create = useReportedMutation<PackageRow, CreateForm>({
    mutationFn: async (form) => (await apiClient.post(BASE, createPayload(form))).data as PackageRow,
    success: (made) => ({ title: 'Package created', message: `“${name(made)}” is a draft. Add the files it should hold.` }),
    failure: "Couldn't create the package", retryable: false, toast: 'success', invalidate: REFRESH,
    onSuccess: (made) => onCreated(made.id),
  });
  const remove = useReportedMutation<unknown, PackageRow>({
    mutationFn: async (p) => (await apiClient.delete(`${BASE}/${p.id}`)).data,
    success: (_, p) => `Deleted “${name(p)}”`, failure: "Couldn't delete the package", invalidate: REFRESH,
    onSuccess: (_, p) => onGone(p.id),
  });
  const finalize = useReportedMutation<unknown, PackageRow>({
    mutationFn: async (p) => (await apiClient.post(`${BASE}/${p.id}/finalize`)).data,
    success: (_, p) => ({ title: `Finalized “${name(p)}”`, message: 'It can no longer be changed. Export it to get the files.' }), failure: "Couldn't finalize the package", invalidate: REFRESH,
  });
  const download = useReportedMutation<unknown, PackageRow>({
    mutationFn: async (p) => {
      const r = await apiClient.get(`${BASE}/${p.id}/download`, { responseType: 'blob' });
      save(r.data as BlobPart, downloadName(p));
      return null;
    },
    success: (_, p) => `Downloaded “${name(p)}”`, failure: "Couldn't download the package", invalidate: [[LOG_KEY]],
  });
  const exportIt = useReportedMutation<unknown, PackageRow>({
    mutationFn: async (p) => { setExporting(p.id); return (await apiClient.post(`${BASE}/${p.id}/export`)).data; },
    success: (_, p) => ({ title: `Exported “${name(p)}”`, message: 'The download starts now. You can download it again from the package.' }), failure: "Couldn't export the package",
    invalidate: REFRESH,
    onSuccess: (_, p) => { setExporting(null); download.mutate(p); },
    onError: () => setExporting(null),
  });
  const hold = useReportedMutation<unknown, { p: PackageRow; on: boolean }>({
    mutationFn: async ({ p, on }) => (await apiClient.post(`${BASE}/${p.id}/legal-hold`, { is_legal_hold: on })).data,
    success: (_, v) => (v.on ? `“${name(v.p)}” is on legal hold` : `Legal hold removed from “${name(v.p)}”`), failure: "Couldn't change the legal hold", invalidate: REFRESH,
  });
  const add = useReportedMutation<unknown, { p: Pick<PackageRow, 'id' | 'name'>; ids: number[] }>({
    mutationFn: async ({ p, ids }) => (await apiClient.post(`${BASE}/${p.id}/evidence`, { evidence_ids: ids })).data,
    success: (_, v) => `Added ${v.ids.length} ${v.ids.length === 1 ? 'file' : 'files'} to “${name(v.p)}”`, failure: "Couldn't add the files", invalidate: REFRESH,
  });
  const removeItem = useReportedMutation<unknown, { packageId: number; itemId: number; file: string }>({
    mutationFn: async ({ packageId, itemId }) => (await apiClient.delete(`${BASE}/${packageId}/evidence/${itemId}`)).data,
    success: (_, v) => `Removed “${truncate(v.file, 60).text}” from the package`, failure: "Couldn't remove the file", invalidate: REFRESH,
  });
  const move = useReportedMutation<unknown, { packageId: number; plan: NonNullable<ReturnType<typeof swapPlan>> }>({
    mutationFn: async ({ packageId, plan }) => {
      for (const step of plan) await apiClient.put(`${BASE}/${packageId}/evidence/${step.itemId}/reorder`, { new_sequence: step.newSequence });     // one after the other: the second must see the first
      return null;
    },
    failure: "Couldn't move the file", invalidate: REFRESH,
  });

  const askDelete = async (p: PackageRow) => {
    const yes = await confirm({ title: `Delete “${name(p)}”?`, message: 'The package is deleted. The evidence files in it are not.', confirmLabel: 'Delete package', tone: 'danger' });
    if (yes) remove.mutate(p);
  };
  const askFinalize = async (p: PackageRow) => {
    const yes = await confirm({
      title: `Finalize “${name(p)}”?`,
      message: `It holds ${p.evidence_count} ${p.evidence_count === 1 ? 'file' : 'files'}. Once finalized no file can be added, removed or reordered.`,
      confirmLabel: 'Finalize package',
    });
    if (yes) finalize.mutate(p);
  };
  const askHold = async (p: PackageRow) => {
    const on = !p.is_legal_hold;
    const yes = await confirm({
      title: on ? `Put “${name(p)}” on legal hold?` : `Remove the legal hold from “${name(p)}”?`,
      message: on ? 'While it is on hold the package cannot be deleted.' : 'The package can be deleted again, if it is still a draft.',
      confirmLabel: on ? 'Put on hold' : 'Remove hold',
    });
    if (yes) hold.mutate({ p, on });
  };
  const askRemoveItem = async (packageId: number, itemId: number, file: string) => {
    const yes = await confirm({ title: 'Remove this file from the package?', message: `“${truncate(file, 80).text}” is removed from the package. The file itself stays in the library.`, confirmLabel: 'Remove file', tone: 'danger' });
    if (yes) removeItem.mutate({ packageId, itemId, file });
  };

  const busy = {
    create: create.isPending,
    remove: remove.isPending ? remove.variables?.id ?? null : null,
    finalize: finalize.isPending ? finalize.variables?.id ?? null : null,
    export: exporting,
    download: download.isPending ? download.variables?.id ?? null : null,
    hold: hold.isPending ? hold.variables?.p.id ?? null : null,
    add: add.isPending,
    item: removeItem.isPending || move.isPending,
  };
  const ui: ReactNode = confirmDialog;

  return {
    busy, ui, notify,
    createMutation: create,
    addMutation: add,
    create: (form: CreateForm) => create.mutate(form),
    askDelete: (p: PackageRow) => { void askDelete(p); },
    askFinalize: (p: PackageRow) => { void askFinalize(p); },
    askHold: (p: PackageRow) => { void askHold(p); },
    askRemoveItem: (packageId: number, itemId: number, file: string) => { void askRemoveItem(packageId, itemId, file); },
    exportIt: (p: PackageRow) => exportIt.mutate(p),
    download: (p: PackageRow) => download.mutate(p),
    move: (packageId: number, plan: NonNullable<ReturnType<typeof swapPlan>>) => move.mutate({ packageId, plan }),
    canRetry,
  };
}
