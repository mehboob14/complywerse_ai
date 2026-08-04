'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { SqlDbForm, softwareKeyToSqlPlatform } from '@/components/integrations/SqlDbForm';
import { assetsApi } from '@/lib/api';

// Prominent purple callout announcing that this software has a CIS benchmark in
// the library, and how many rules can actually run against it (the count is the
// scanner's real executable set — hollow auto-pass and manual rules already
// excluded server-side). Shown before the credential form so the operator sees
// WHY they're setting it up.
function BenchmarkCallout({
  ruleCount, benchmarkName, body,
}: { ruleCount: number; benchmarkName?: string; body: string }) {
  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-purple-100 text-purple-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold leading-none text-purple-900">{ruleCount}</span>
            <span className="text-sm font-semibold text-purple-900">
              CIS rule{ruleCount === 1 ? '' : 's'} ready to run
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-purple-800">{body}</p>
          {benchmarkName && (
            <p className="mt-2 font-mono text-[11px] text-purple-700 break-all">{benchmarkName}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export type SoftwareSetupEntry = {
  software_key: string;
  name: string;
  version?: string;
  publisher?: string;
  benchmark_available?: boolean;
  benchmark_name?: string;
  rule_count?: number;
  promoted_asset_id?: number | null;
};

export type SoftwareSetupDrawerProps = {
  open: boolean;
  onClose: () => void;
  hostAssetId: number;
  hostName?: string;
  hostIp?: string;
  entry: SoftwareSetupEntry;
  /** Called after a successful setup so parents can invalidate queries. */
  onComplete?: () => void;
};

export function SoftwareSetupDrawer({
  open,
  onClose,
  hostAssetId,
  hostName,
  hostIp,
  entry,
  onComplete,
}: SoftwareSetupDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const sqlPlatform = softwareKeyToSqlPlatform(entry.software_key);
  const alreadyPromoted = Boolean(entry.promoted_asset_id);
  const ruleCount = entry.rule_count ?? 0;
  const subtitle = [entry.version, entry.publisher].filter(Boolean).join(' · ')
    || entry.software_key;

  async function runSetup(
    mode: 'scan' | 'host_connection' | 'track',
    extra?: Record<string, unknown>,
  ) {
    setBusy(true);
    setError(null);
    try {
      await assetsApi.setupSoftware(hostAssetId, {
        mode,
        software_key: entry.software_key,
        ...extra,
      });
      setDone(true);
      onComplete?.();
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setError(typeof d === 'string' ? d : e?.message || 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    setError(null);
    setDone(false);
    setBusy(false);
    onClose();
  }

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={handleClose}
      title={entry.name || entry.software_key}
      subtitle={subtitle}
      width="w-full max-w-lg"
    >
      <div className="space-y-5">
        {(hostName || hostIp) && (
          <p className="text-xs text-slate-500">
            Host: <span className="font-medium text-slate-700">{hostName || '—'}</span>
            {hostIp ? <span className="font-mono text-slate-600"> · {hostIp}</span> : null}
          </p>
        )}

        {alreadyPromoted && entry.promoted_asset_id != null && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Already in inventory as asset{' '}
            <Link
              href={`/assets/${entry.promoted_asset_id}`}
              className="font-semibold text-primary-600 hover:underline"
            >
              #{entry.promoted_asset_id}
            </Link>
            .
          </div>
        )}

        {!alreadyPromoted && done && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Software set up successfully.
          </div>
        )}

        {!alreadyPromoted && !done && entry.benchmark_available && sqlPlatform && (
          <div className="space-y-4">
            <BenchmarkCallout
              ruleCount={ruleCount}
              benchmarkName={entry.benchmark_name}
              body="Give it a read-only database login below to bring it into inventory and scan it against these rules."
            />
            <SqlDbForm
              platform={sqlPlatform}
              embedded
              initialHostname={hostIp || hostName || ''}
              initialLabel={entry.name || entry.software_key}
              onCancel={handleClose}
              onSuccess={() => {
                setDone(true);
                onComplete?.();
              }}
              onSubmitCredentials={async (creds) => {
                await assetsApi.setupSoftware(hostAssetId, {
                  mode: 'scan',
                  software_key: entry.software_key,
                  ...creds,
                });
              }}
            />
          </div>
        )}

        {!alreadyPromoted && !done && entry.benchmark_available && !sqlPlatform && (
          <div className="space-y-4">
            <BenchmarkCallout
              ruleCount={ruleCount}
              benchmarkName={entry.benchmark_name}
              body="Scanning uses the host's OS connection — no separate software credentials are required."
            />
            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                {error}
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => runSetup('host_connection')}
              className="inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-[color:var(--color-on-base,#0a0a0a)] shadow-sm hover:bg-primary-700 disabled:opacity-60"
            >
              {busy ? 'Adding…' : 'Add as scannable asset (host credentials)'}
            </button>
          </div>
        )}

        {!alreadyPromoted && !done && !entry.benchmark_available && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Track as asset (no benchmark)</p>
              <p className="mt-1 text-slate-600">
                No CIS benchmark is available for this software. Tracking adds it to inventory
                only — no scan will run.
              </p>
            </div>
            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                {error}
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => runSetup('track')}
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            >
              {busy ? 'Tracking…' : 'Track as asset (no scan)'}
            </button>
          </div>
        )}
      </div>
    </RightSlidePanel>
  );
}
