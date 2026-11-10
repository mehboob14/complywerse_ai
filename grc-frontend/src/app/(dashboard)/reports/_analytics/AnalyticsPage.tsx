'use client';

/**
 * Analytics: a plain launcher for the advanced analytics tool. One line says whether it is connected (or that it is not set up and an administrator has to do it), "Open analytics" opens the tool in a new tab, and the ready-made
 * dashboards open either in this page (when the server can embed them) or in a new tab. Nothing here names the tool's product, its settings or its addresses: those belong to Administration. A failed status read says so with Retry; a
 * failed open says why in words (not set up, no right, the server did not answer). The new tab is opened in the click itself and sent to the address once the server has made it: a pop-up blocker lets a tab opened in a click through, and
 * when one still stops it the page offers the same address as a link. Only the person's own sign-in is sent: no group or role is ever asked for from here.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, LayoutDashboard, X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Notice, Skeleton, StatusPill } from '@/components/ui/ds';
import { reportingMetabaseApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { analyticsConnection } from '@/lib/statuses/trends';
import { openFailure, openHow, openLabel, readStatus, statusOf, validFor, type StarterDashboard } from './analyticsModel';

export const TITLE = 'Analytics';
const INFO = 'Dashboards and reports across all your modules, in the advanced analytics tool. Use Reports to download a single register.';
const CARD = 'flex min-w-0 flex-col items-start gap-[4px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px] text-left';
const CARD_BUTTON = `${CARD} hover:border-ds-border-strong hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60`;

interface Embedded { key: string; title: string; url: string; validFor: string }

export function AnalyticsPage() {
  const statusQuery = useQuery({ queryKey: ['reporting', 'metabase-status'], queryFn: async () => (await reportingMetabaseApi.status()).data as Record<string, unknown> });
  const [busy, setBusy] = useState<string | null>(null);                 // what is being opened: '' (the tool) or a dashboard's key
  const [embedded, setEmbedded] = useState<Embedded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);           // an address the browser did not let a new tab open: offered as a link

  const status = statusQuery.data ? readStatus(statusQuery.data) : null;

  /** Opens the tool (optionally at a dashboard) in a new tab. The tab is opened NOW, inside the click, and pointed at the address when it arrives. */
  const openTool = async (returnTo: string, what: string) => {
    setFailure(null);
    setBlocked(null);
    setBusy(what);
    const tab = window.open('about:blank', '_blank');
    try {
      const res = await reportingMetabaseApi.sso({ return_to: returnTo });
      const url = res.data?.url as string | undefined;
      if (!url) throw new Error('no address');
      if (tab) { tab.opener = null; tab.location.href = url; } else setBlocked(url);
    } catch (e) {
      tab?.close();
      setFailure(openFailure(statusOf(e)));
    } finally {
      setBusy(null);
    }
  };

  const embed = async (d: StarterDashboard) => {
    setFailure(null);
    setBlocked(null);
    setBusy(d.key);
    try {
      const res = await reportingMetabaseApi.embedDashboard(d.key);
      const url = res.data?.url as string | undefined;
      if (!url) throw new Error('no address');
      setEmbedded({ key: d.key, title: d.title, url, validFor: validFor(res.data?.expires_in) });
    } catch (e) {
      setFailure(openFailure(statusOf(e)));
    } finally {
      setBusy(null);
    }
  };

  const open = (d: StarterDashboard) => {
    if (!status) return;
    if (openHow(status, d) === 'here') void embed(d);
    else void openTool(d.viewId ? `/dashboard/${d.viewId}` : '/', d.key);
  };

  const header = (
    <PageHeader
      variant="page"
      title={TITLE}
      info={INFO}
      chips={status ? <StatusPill {...statusPill(analyticsConnection, status.ready ? 'ready' : 'not_set_up')} /> : undefined}
      actions={status?.ready ? <Button variant="primary" rightIcon={<ExternalLink aria-hidden />} loading={busy === ''} disabled={busy !== null && busy !== ''} onClick={() => { void openTool('/', ''); }}>Open analytics</Button> : undefined}
    />
  );

  if (statusQuery.isPending) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {header}
        <div role="status" aria-busy="true" className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <span className="sr-only">Checking whether advanced analytics is set up</span>
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] w-full" />)}
        </div>
      </div>
    );
  }
  if (statusQuery.isError || !status) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {header}
        <ErrorState title="Couldn't check analytics" message="The server did not answer. Check your connection and try again." onRetry={() => { void statusQuery.refetch(); }} />
      </div>
    );
  }
  if (!status.ready) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {header}
        <EmptyState kind="firstUse" icon={LayoutDashboard} title={status.headline} description={status.detail} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      {header}
      <p className="m-0 text-ds-body text-ds-fg-body">{status.detail}</p>

      {failure && <Notice tone="danger" title="Couldn't open it" action={<Button onClick={() => setFailure(null)}>Dismiss</Button>}>{failure}</Notice>}
      {blocked && (
        <Notice tone="warning" title="Your browser blocked the new tab" action={<Button href={blocked} target="_blank" rel="noopener noreferrer" rightIcon={<ExternalLink aria-hidden />} onClick={() => setBlocked(null)}>Open analytics</Button>}>
          Allow pop-ups for this site, or open it from here.
        </Notice>
      )}

      {status.dashboards.length > 0 && (
        <section aria-labelledby="analytics-ready-made" className="flex flex-col gap-[8px]">
          <h2 id="analytics-ready-made" className="m-0 !text-ds-section !font-[600] !text-ds-fg">Ready-made dashboards</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-[12px] p-0 sm:grid-cols-2">
            {status.dashboards.map((d) => {
              const how = openHow(status, d);
              const wait = busy === d.key;
              return (
                <li key={d.key} className="min-w-0">
                  <button type="button" className={`${CARD_BUTTON} w-full`} aria-disabled={busy !== null || undefined} aria-busy={wait || undefined} onClick={() => { if (busy === null) open(d); }}>
                    <span className="text-ds-body font-[600] text-ds-fg">{d.title}</span>
                    {d.hint && <span className="text-ds-body text-ds-fg-muted">{d.hint}</span>}
                    <span className="mt-[8px] inline-flex items-center gap-[4px] text-ds-body font-medium text-ds-primary-text">
                      {wait ? 'Opening…' : openLabel(how)}
                      {how === 'tab' && <ExternalLink aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {embedded && (
        <section aria-label={embedded.title} className="flex flex-col gap-[8px]">
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <h2 className="m-0 !text-ds-section !font-[600] !text-ds-fg">{embedded.title}</h2>
            <Button leftIcon={<X aria-hidden />} onClick={() => setEmbedded(null)}>Close</Button>
          </div>
          {embedded.validFor && <p className="m-0 text-ds-label text-ds-fg-muted">{`This view stays open for ${embedded.validFor}. Choose the dashboard again to refresh it.`}</p>}
          <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
            <iframe title={embedded.title} src={embedded.url} className="block h-[70vh] w-full" allow="fullscreen" referrerPolicy="no-referrer" />
          </div>
        </section>
      )}
    </div>
  );
}
