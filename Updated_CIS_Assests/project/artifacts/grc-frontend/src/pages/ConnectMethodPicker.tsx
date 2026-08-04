'use client';

/**
 * ConnectMethodPicker — step 0 before the Connect Wizard.
 *
 * Shown for OS-level assets (Windows / Linux) where both agent-based and
 * agentless scanning are valid options. The user picks their preferred
 * method here; app-level assets (MSSQL, Postgres, Tomcat, etc.) skip
 * this page entirely and go straight to the Connect Wizard because only
 * agentless applies to them.
 *
 * URL params:
 *   platform   — 'windows' | 'linux'
 *   asset_id   — numeric asset id
 *   name       — display name of the asset
 *   ip         — IP address of the asset
 */

import { useLocation } from 'wouter';
import { Server, Radio, ArrowLeft, ShieldCheck, Clock, Cpu, Wifi, ChevronRight } from 'lucide-react';

const OS_META: Record<string, { label: string; icon: string; agentless: string; agentNote: string }> = {
  windows: {
    label: 'Windows',
    icon: '🪟',
    agentless: 'WinRM over HTTPS — read-only audit account',
    agentNote: 'Installs as a Windows service (.cmd installer, ~4 MB). Runs CIS scans on a schedule and reports back automatically.',
  },
  linux: {
    label: 'Linux',
    icon: '🐧',
    agentless: 'SSH key-based access — read-only audit user',
    agentNote: 'Installs via a shell script (.sh, ~3 MB). Supports Ubuntu, RHEL, CentOS, Amazon Linux, Debian.',
  },
};

export default function ConnectMethodPicker() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const platform = params.get('platform') || 'windows';
  const assetId  = params.get('asset_id') || '';
  const name     = params.get('name') || 'Asset';
  const ip       = params.get('ip') || '';

  const meta = OS_META[platform] ?? OS_META['windows'];

  function goAgentless() {
    const dest = `/integrations/connect?platform=${platform}${assetId ? `&asset_id=${assetId}` : ''}`;
    navigate(dest);
  }

  function goAgent() {
    // Agent enrollment page — pass the platform so the right OS card is
    // highlighted. The asset_id hint helps the admin page pre-select the
    // asset to link the enrolled agent to.
    const dest = `/admin/agents?platform=${platform}${assetId ? `&asset_id=${assetId}` : ''}`;
    navigate(dest);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-start py-10 px-4">
      {/* Back link */}
      <div className="w-full max-w-2xl mb-6">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {/* Asset context card */}
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-sm px-6 py-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-xl">
            {meta.icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{meta.label} · Setting up CIS scanning</div>
            <div className="text-base font-semibold text-slate-800 truncate">{name}</div>
            {ip && <div className="font-mono text-xs text-slate-400">{ip}</div>}
          </div>
        </div>
      </div>

      {/* Heading */}
      <div className="w-full max-w-2xl mb-6 text-center">
        <h1 className="text-xl font-bold text-slate-900">How do you want to connect?</h1>
        <p className="mt-1 text-sm text-slate-500">
          Both methods run the same CIS benchmarks and update the same compliance score.
          Pick the approach that fits your environment.
        </p>
      </div>

      {/* Method cards */}
      <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">

        {/* ── AGENT card ───────────────────────────────────────────────── */}
        <button
          onClick={goAgent}
          className="group text-left bg-white border-2 border-slate-200 hover:border-teal-500 rounded-xl shadow-sm px-5 py-5 transition focus:outline-none focus:ring-2 focus:ring-teal-400"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <Cpu className="h-5 w-5" />
            </div>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">Recommended</span>
          </div>

          <h2 className="text-sm font-bold text-slate-900 mb-1">Agent</h2>
          <p className="text-xs text-slate-500 mb-4">{meta.agentNote}</p>

          <ul className="space-y-1.5 mb-4">
            <li className="flex items-start gap-2 text-xs text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-teal-500 flex-shrink-0 mt-px" />
              Automatic scheduled scans — no manual trigger needed
            </li>
            <li className="flex items-start gap-2 text-xs text-slate-600">
              <Radio className="h-3.5 w-3.5 text-teal-500 flex-shrink-0 mt-px" />
              Live software discovery — detects new apps as they're installed
            </li>
            <li className="flex items-start gap-2 text-xs text-slate-600">
              <Wifi className="h-3.5 w-3.5 text-teal-500 flex-shrink-0 mt-px" />
              Outbound-only — no inbound firewall rule needed
            </li>
          </ul>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Takes ~2 min to install</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 group-hover:underline">
              Download installer <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </button>

        {/* ── AGENTLESS card ───────────────────────────────────────────── */}
        <button
          onClick={goAgentless}
          className="group text-left bg-white border-2 border-slate-200 hover:border-blue-500 rounded-xl shadow-sm px-5 py-5 transition focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Server className="h-5 w-5" />
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">No install</span>
          </div>

          <h2 className="text-sm font-bold text-slate-900 mb-1">Agentless</h2>
          <p className="text-xs text-slate-500 mb-4">{meta.agentless}</p>

          <ul className="space-y-1.5 mb-4">
            <li className="flex items-start gap-2 text-xs text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-px" />
              Nothing installed on the target machine
            </li>
            <li className="flex items-start gap-2 text-xs text-slate-600">
              <Clock className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-px" />
              On-demand scans — triggered manually from the platform
            </li>
            <li className="flex items-start gap-2 text-xs text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-px" />
              Works for assets where installing software isn't allowed
            </li>
          </ul>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Requires network access + credentials</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 group-hover:underline">
              Set up credentials <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </button>
      </div>

      {/* Footer note */}
      <p className="text-xs text-slate-400 text-center max-w-md">
        You can switch methods at any time. Agent and agentless scans both write to the same
        compliance score — whichever ran last wins.
      </p>
    </div>
  );
}
