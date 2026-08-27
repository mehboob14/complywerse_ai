'use client';

// Brand logo for an evidence-collector provider. Staged fallback:
//   1. local hand-placed SVG  /connectors/<provider>.svg   (crisp, offline)
//   2. Clearbit domain logo   logo.clearbit.com/<domain>    (real brand mark)
//   3. initials tile                                        (always renders)
// Same idiom as FrameworkLogo — drop a new /connectors/<key>.svg and it wins.

import { useState } from 'react';

const DOMAIN: Record<string, string> = {
  github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org', okta: 'okta.com',
  google_workspace: 'google.com', microsoft_365: 'microsoft.com', clerk: 'clerk.com',
  tailscale: 'tailscale.com', one_password: '1password.com', cloudflare: 'cloudflare.com',
  vercel: 'vercel.com', netlify: 'netlify.com', heroku: 'heroku.com', render: 'render.com',
  supabase: 'supabase.com', neon: 'neon.tech', qovery: 'qovery.com', digitalocean: 'digitalocean.com',
  datadog: 'datadoghq.com', sentry: 'sentry.io', grafana: 'grafana.com', signoz: 'signoz.io',
  posthog: 'posthog.com', better_stack: 'betterstack.com', pagerduty: 'pagerduty.com',
  notion: 'notion.so', linear: 'linear.app', asana: 'asana.com', jira: 'atlassian.com',
  clickup: 'clickup.com', monday: 'monday.com', slack: 'slack.com', zendesk: 'zendesk.com',
  intercom: 'intercom.com', hubspot: 'hubspot.com', sendgrid: 'twilio.com', resend: 'resend.com',
  openai: 'openai.com', anthropic: 'anthropic.com',
};
// Providers we ship a crisp local SVG for (public/connectors/<key>.svg).
const HAS_SVG = new Set([
  'github', 'gitlab', 'bitbucket', 'okta', 'cloudflare', 'digitalocean', 'heroku',
  'datadog', 'sentry', 'pagerduty', 'linear', 'asana', 'jira', 'slack', 'google_workspace',
]);

function initials(label: string): string {
  const parts = (label || '?').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
  return (parts.slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?');
}

export function ConnectorLogo({ provider, label, size = 48 }: { provider: string; label: string; size?: number }) {
  const [stage, setStage] = useState(HAS_SVG.has(provider) ? 0 : 1);
  const domain = DOMAIN[provider];
  const src = stage === 0 ? `/connectors/${provider}.svg` : stage === 1 && domain ? `https://logo.clearbit.com/${domain}?size=128` : null;

  if (!src) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 font-bold text-slate-500"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
        aria-hidden
      >
        {initials(label)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setStage((s) => (s === 0 && domain ? 1 : 2))}
      className="shrink-0 rounded-lg border border-slate-100 bg-white object-contain p-1"
      style={{ width: size, height: size }}
    />
  );
}
