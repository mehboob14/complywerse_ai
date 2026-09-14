'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { reportingMetabaseApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

type StarterDash = {
  key: string;
  title: string;
  hint: string;
  metabase_dashboard_id?: number | null;
};

type MetabaseStatus = {
  configured: boolean;
  site_url?: string | null;
  embed_enabled: boolean;
  jwt_sso?: boolean;
  static_embed?: boolean;
  mode: 'embed' | 'sso_link' | 'static_embed' | 'open_link' | 'not_configured';
  reporting_views: string[];
  view_catalog: { view: string; metabase_model_hint: string; requires: string[] }[];
  starter_dashboards: StarterDash[];
  subscriptions?: {
    owner: string;
    requires: string[];
    hint: string;
    mailhog_ui?: string;
    configure_script?: string;
  };
  licence_note?: string;
};

export default function ReportsAnalyticsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [opening, setOpening] = useState<string | null>(null);
  const [activeEmbed, setActiveEmbed] = useState<{ key: string; title: string; url: string } | null>(null);
  const [embedLoading, setEmbedLoading] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['reporting', 'metabase-status'],
    queryFn: async () => (await reportingMetabaseApi.status()).data as MetabaseStatus,
  });

  const ensureViews = useMutation({
    mutationFn: async () => (await reportingMetabaseApi.ensureViews()).data,
    onSuccess: (data) => {
      toast({
        title: 'Reporting views ready',
        message: `Applied: ${(data.applied || []).join(', ') || 'none'}`,
        type: 'success',
      });
      qc.invalidateQueries({ queryKey: ['reporting', 'metabase-status'] });
    },
    onError: (err: any) => {
      toast({
        title: String(err?.response?.data?.detail || 'Could not ensure views'),
        type: 'error',
      });
    },
  });

  const openAnalytics = async (returnTo = '/') => {
    setOpening(returnTo);
    try {
      const res = await reportingMetabaseApi.sso({ return_to: returnTo });
      const url = res.data?.url as string | undefined;
      if (!url) throw new Error('No SSO URL returned');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast({
        title: String(err?.response?.data?.detail || err?.message || 'SSO failed'),
        type: 'error',
      });
    } finally {
      setOpening(null);
    }
  };

  const openStarter = async (d: StarterDash) => {
    const status = statusQuery.data;
    if (status?.static_embed && d.metabase_dashboard_id) {
      setEmbedLoading(true);
      try {
        const res = await reportingMetabaseApi.embedDashboard(d.key);
        const url = res.data?.url as string | undefined;
        if (!url) throw new Error('No embed URL');
        setActiveEmbed({ key: d.key, title: d.title, url });
      } catch (err: any) {
        toast({
          title: String(err?.response?.data?.detail || err?.message || 'Embed failed'),
          type: 'error',
        });
        await openAnalytics(`/dashboard/${d.metabase_dashboard_id}`);
      } finally {
        setEmbedLoading(false);
      }
      return;
    }
    if (d.metabase_dashboard_id) {
      await openAnalytics(`/dashboard/${d.metabase_dashboard_id}`);
      return;
    }
    await openAnalytics('/');
  };

  const status = statusQuery.data;
  const modeLabel = useMemo(() => {
    if (!status) return '…';
    if (status.mode === 'embed') return 'Embed ready (JWT SSO)';
    if (status.mode === 'sso_link') return 'SSO deep-link (Pro JWT)';
    if (status.mode === 'static_embed') return 'Static embeds (OSS)';
    if (status.mode === 'open_link') return 'Open Metabase (login in tab)';
    return 'Not configured';
  }, [status]);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
          <p className="mt-1 text-sm text-gray-600">
            Cross-module reports and dashboards powered by Metabase Models on your tenant data.
            Use <Link href="/reports" className="underline text-slate-800">Quick export</Link> for
            simple single-register CSVs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => ensureViews.mutate()}
            disabled={ensureViews.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {ensureViews.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Ensure reporting views
          </button>
          <button
            type="button"
            onClick={() => openAnalytics('/')}
            disabled={!status?.configured || opening !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {opening === '/' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Open Analytics
          </button>
        </div>
      </div>

      {statusQuery.isLoading && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-500">
          Checking Metabase configuration…
        </div>
      )}

      {status && !status.configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> Metabase is not configured yet
          </div>
          <p>
            Set <code className="font-mono text-xs">METABASE_SITE_URL</code> on the backend,
            then deploy Metabase (see <code className="font-mono text-xs">deploy/metabase/</code>).
            Semantic <code className="font-mono text-xs">reporting_*</code> views can still be created
            on this tenant with <strong>Ensure reporting views</strong>.
          </p>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">Connection</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-gray-900">
              {status.configured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              {modeLabel}
            </div>
            {status.site_url && (
              <div className="mt-1 truncate text-xs text-gray-500">{status.site_url}</div>
            )}
            {status.licence_note && (
              <div className="mt-2 text-xs text-gray-500">{status.licence_note}</div>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">Reporting views</div>
            <div className="mt-1 text-2xl font-semibold">{status.reporting_views?.length ?? 0}</div>
            <div className="text-xs text-gray-500">on this tenant database</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">Starter dashboards</div>
            <div className="mt-1 text-2xl font-semibold">
              {status.starter_dashboards?.length ?? 0}
            </div>
            <div className="text-xs text-gray-500">curated packs</div>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4" /> Starter dashboards
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(status?.starter_dashboards || []).map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => openStarter(d)}
              disabled={!status?.configured || opening !== null || embedLoading}
              className="rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60"
            >
              <div className="font-medium text-gray-900">{d.title}</div>
              <div className="mt-1 text-sm text-gray-600">{d.hint}</div>
              <div className="mt-3 text-xs font-medium text-slate-700 inline-flex items-center gap-1">
                {status?.static_embed && d.metabase_dashboard_id
                  ? 'View embedded'
                  : 'Open in Metabase'}{' '}
                <ExternalLink className="h-3 w-3" />
              </div>
            </button>
          ))}
        </div>
      </section>

      {activeEmbed && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">{activeEmbed.title}</h2>
            <button
              type="button"
              className="text-xs text-slate-600 underline"
              onClick={() => setActiveEmbed(null)}
            >
              Close
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <iframe
              title={activeEmbed.title}
              src={activeEmbed.url}
              className="h-[70vh] w-full"
              allow="fullscreen"
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Database className="h-4 w-4" /> Semantic Models (reporting_* views)
        </h2>
        <p className="text-sm text-gray-600">
          In Metabase, create Models from these views — then add custom columns (counts, averages)
          and dashboards without fighting the old linkage UI.
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">View</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Model name</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">On tenant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(status?.view_catalog || []).map((v) => {
                const present = status?.reporting_views?.includes(v.view);
                return (
                  <tr key={v.view}>
                    <td className="px-4 py-2 font-mono text-xs">{v.view}</td>
                    <td className="px-4 py-2">{v.metabase_model_hint}</td>
                    <td className="px-4 py-2">
                      {present ? (
                        <span className="text-emerald-700 text-xs font-medium">ready</span>
                      ) : (
                        <span className="text-amber-700 text-xs font-medium">pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 space-y-2">
        <div className="font-medium text-gray-900 flex items-center gap-2">
          <Mail className="h-4 w-4" /> Subscriptions
        </div>
        <p>
          {status?.subscriptions?.hint ||
            'Configure SMTP in Metabase Admin → Settings → Email, then use Sharing → Subscriptions on a dashboard.'}
        </p>
        {status?.subscriptions?.mailhog_ui && (
          <p className="text-xs">
            Local inbox:{' '}
            <a
              className="underline text-slate-800"
              href={status.subscriptions.mailhog_ui}
              target="_blank"
              rel="noreferrer"
            >
              {status.subscriptions.mailhog_ui}
            </a>
          </p>
        )}
        <p className="text-xs text-gray-500">
          Email packs are owned by Metabase (not ComplyVerse). Prefer weekly Risk posture and Vendor &amp; TPRA.
        </p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 space-y-2">
        <div className="font-medium text-gray-900 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> How to build a cross-module report
        </div>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Ensure reporting views on this tenant (button above).</li>
          <li>Open Analytics (Metabase) and start from a Model (e.g. Vendors Tpra).</li>
          <li>Add metrics: count of open findings, average residual score, …</li>
          <li>Save the question → add to a dashboard → set shared filters.</li>
          <li>Subscribe the dashboard for weekly email (Metabase → Sharing → Subscriptions).</li>
        </ol>
      </section>
    </div>
  );
}
