'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

// Single source of truth for the agent-setup user journey.
// Replaces the previous "+ Install New Agent" and "⚡ Bulk Enroll" modals
// with one progressive wizard:
//   1. Method      → Agentless vs With-Agent
//   2. Agent type  → Endpoint vs Collector            (skipped for Agentless)
//   3. How many    → Single / Bulk / From Discovery   (skipped for Agentless)
//   4. Configure   → form (shape depends on choices above)
//   5. Result      → install commands or CSV + next steps

type Step = 'method' | 'agent_type' | 'enrollment_method' | 'configure' | 'result';
type Method = 'agentless' | 'agent';
type AgentMode = 'endpoint' | 'collector';
type EnrollMethod = 'single' | 'bulk' | 'discovery';

type SingleResult = {
  agent_id: number;
  enrollment_token: string;
  install_command_windows: string;
  install_command_linux: string;
  backend_url: string;
};

type BulkResult = {
  backend_url: string;
  count: number;
  agents: Array<{
    agent_id: number;
    hostname: string;
    enrollment_token: string;
    install_command_windows: string;
    install_command_linux: string;
  }>;
};

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
  /** When the wizard is launched from /admin/discover with a prefilled
   *  hostname list, the launcher passes them in so we skip to the Configure
   *  step with everything already filled. */
  discoveryPrefill?: {
    hostnames: string[];
    mode?: AgentMode;
    osFamily?: string;
  } | null;
}

export default function SetupWizard({ open, onClose, discoveryPrefill }: SetupWizardProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();

  // Wizard state
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<Method | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode | null>(null);
  const [enrollMethod, setEnrollMethod] = useState<EnrollMethod | null>(null);

  // Form fields
  const [singleName, setSingleName] = useState('');
  const [bulkHostnames, setBulkHostnames] = useState('');
  const [osFamily, setOsFamily] = useState('windows');

  // Results
  const [singleResult, setSingleResult] = useState<SingleResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [copied, setCopied] = useState<string>('');

  // Reset when the wizard closes/reopens — keeps the UX predictable.
  useEffect(() => {
    if (!open) {
      setStep('method');
      setMethod(null);
      setAgentMode(null);
      setEnrollMethod(null);
      setSingleName('');
      setBulkHostnames('');
      setOsFamily('windows');
      setSingleResult(null);
      setBulkResult(null);
      setCopied('');
    }
  }, [open]);

  // Handle Discovery → Wizard handoff: prefilled hostnames mean the user
  // already picked "Bulk" implicitly, so we jump straight to Configure.
  useEffect(() => {
    if (open && discoveryPrefill?.hostnames?.length) {
      setMethod('agent');
      setAgentMode(discoveryPrefill.mode || 'endpoint');
      setEnrollMethod('bulk');
      setBulkHostnames(discoveryPrefill.hostnames.join('\n'));
      if (discoveryPrefill.osFamily) setOsFamily(discoveryPrefill.osFamily);
      setStep('configure');
    }
  }, [open, discoveryPrefill]);

  const singleMut = useMutation({
    mutationFn: () => agentsApi.enroll({
      agent_name: singleName.trim(),
      mode: agentMode || 'collector',
      os_family: osFamily,
    }),
    onSuccess: (res) => {
      setSingleResult(res.data);
      qc.invalidateQueries({ queryKey: ['agents'] });
      setStep('result');
      toast.toast({ title: 'Agent created', message: 'Install token generated.', type: 'success' });
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.toast({ title: 'Could not create agent', message: err?.response?.data?.detail || 'Server rejected the request.', type: 'error' });
    },
  });

  const bulkMut = useMutation({
    mutationFn: () => {
      const hosts = bulkHostnames
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(hostname => ({ hostname, mode: agentMode || 'endpoint', os_family: osFamily }));
      return agentsApi.bulkEnroll({ hosts });
    },
    onSuccess: (res) => {
      setBulkResult(res.data);
      qc.invalidateQueries({ queryKey: ['agents'] });
      setStep('result');
      toast.toast({ title: `${res.data.count} agents enrolled`, message: 'CSV ready.', type: 'success' });
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.toast({ title: 'Bulk enroll failed', message: err?.response?.data?.detail || 'Server rejected the request.', type: 'error' });
    },
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const downloadCsv = () => {
    if (!bulkResult) return;
    const header = 'hostname,agent_id,enrollment_token,install_command_windows,install_command_linux';
    const rows = bulkResult.agents.map(a =>
      [a.hostname, a.agent_id, a.enrollment_token,
       `"${a.install_command_windows.replace(/"/g, '""')}"`,
       `"${a.install_command_linux.replace(/"/g, '""')}"`].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `enrollments_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // GPO deploy script is served by the cloud at /grc/agent/deploy-gpo.ps1
  // with the backend URL pre-patched so the operator doesn't need to edit it.
  // We open it via an <a download> click rather than fetching, so the browser
  // streams the file straight to disk and preserves the .ps1 extension.
  const downloadGpoScript = () => {
    const link = document.createElement('a');
    link.href = '/grc/agent/deploy-gpo.ps1';
    link.download = 'Deploy-ComplyverseAgent.ps1';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!open) return null;

  // Step indices for the breadcrumb — Agentless skips two of the steps,
  // so we recompute the visible chain instead of hard-coding 5.
  const chain: Step[] = method === 'agentless'
    ? ['method', 'configure']
    : ['method', 'agent_type', 'enrollment_method', 'configure', 'result'];
  const currentIdx = chain.indexOf(step);

  const labelFor = (s: Step): string => ({
    method: 'Method',
    agent_type: 'Type',
    enrollment_method: 'How many',
    configure: 'Configure',
    result: 'Done',
  })[s];

  // ─── Navigation helpers ───────────────────────────────────────────
  const goBack = () => {
    if (step === 'agent_type') setStep('method');
    else if (step === 'enrollment_method') setStep('agent_type');
    else if (step === 'configure') {
      if (method === 'agentless') setStep('method');
      else setStep('enrollment_method');
    }
    else if (step === 'result') setStep('configure');
  };

  const canNext = (): boolean => {
    if (step === 'method') return method !== null;
    if (step === 'agent_type') return agentMode !== null;
    if (step === 'enrollment_method') return enrollMethod !== null;
    return false;
  };

  const onNext = () => {
    if (step === 'method') {
      if (method === 'agentless') {
        // Agentless flow lives in the Connect Wizard already — redirect there
        // instead of duplicating that page's runner-type picker in this modal.
        onClose();
        router.push('/admin/integrations/connect');
        return;
      }
      setStep('agent_type');
    } else if (step === 'agent_type') setStep('enrollment_method');
    else if (step === 'enrollment_method') {
      if (enrollMethod === 'discovery') {
        // No hostnames stashed — send them to /admin/discover to do a scan,
        // then they'll land back here pre-filled via sessionStorage.
        onClose();
        router.push('/admin/discover');
        return;
      }
      setStep('configure');
    }
  };

  const onSubmit = () => {
    if (enrollMethod === 'single') singleMut.mutate();
    else bulkMut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        {/* Header + breadcrumb */}
        <div className="px-5 pt-4 pb-2.5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-base font-semibold text-gray-900">🪄 Setup Wizard</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>
          <ol className="flex items-center gap-1.5 text-xs">
            {chain.map((s, i) => {
              const isActive = i === currentIdx;
              const isDone = i < currentIdx;
              return (
                <li key={s} className="flex items-center gap-1.5">
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full font-semibold ${
                    isDone ? 'bg-green-600 text-white'
                    : isActive ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                  }`}>{isDone ? '✓' : i + 1}</span>
                  <span className={`font-medium ${
                    isActive ? 'text-blue-700' : isDone ? 'text-green-700' : 'text-gray-500'
                  }`}>{labelFor(s)}</span>
                  {i < chain.length - 1 && (
                    <span className={`mx-0.5 ${isDone ? 'text-green-400' : 'text-gray-300'}`}>›</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {/* ─── STEP 1: METHOD ─── */}
          {step === 'method' && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">How do you want to scan?</h3>
              <p className="text-xs text-gray-500 mb-3">Pick the deployment that fits your security posture.</p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => setMethod('agentless')}
                  className={`text-left p-3 rounded-lg border-2 transition ${
                    method === 'agentless' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5"><span className="text-xl">📡</span><span className="font-semibold text-sm">Agentless</span></div>
                  <div className="text-xs text-gray-600 mb-2">Cloud directly connects to your targets over WinRM / SSH / SQL.</div>
                  <ul className="text-[11px] space-y-0">
                    <li className="text-green-700">✓ Quick setup, no install</li>
                    <li className="text-red-600">✗ Firewall must allow inbound</li>
                    <li className="text-red-600">✗ Creds stored in cloud DB</li>
                  </ul>
                  <div className="text-[11px] text-gray-500 mt-1.5 pt-1.5 border-t border-gray-200">Best for: small / test</div>
                </button>

                <button
                  onClick={() => setMethod('agent')}
                  className={`text-left p-3 rounded-lg border-2 transition ${
                    method === 'agent' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5"><span className="text-xl">🛡️</span><span className="font-semibold text-sm">With Agent</span></div>
                  <div className="text-xs text-gray-600 mb-2">Small program on your network calls cloud outbound.</div>
                  <ul className="text-[11px] space-y-0">
                    <li className="text-green-700">✓ Firewall closed (outbound only)</li>
                    <li className="text-green-700">✓ Creds stay on-prem</li>
                    <li className="text-green-700">✓ Bank's preferred mode</li>
                  </ul>
                  <div className="text-[11px] text-gray-500 mt-1.5 pt-1.5 border-t border-gray-200">Best for: production / paranoid banks</div>
                </button>
              </div>
            </>
          )}

          {/* ─── STEP 2: AGENT TYPE ─── */}
          {step === 'agent_type' && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">What does the agent scan?</h3>
              <p className="text-xs text-gray-500 mb-3">This determines whether the agent watches its own host or reaches out to others.</p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => setAgentMode('endpoint')}
                  className={`text-left p-3 rounded-lg border-2 transition ${
                    agentMode === 'endpoint' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5"><span className="text-xl">🏠</span><span className="font-semibold text-sm">Endpoint</span><span className="ml-auto text-[10px] text-blue-700 bg-blue-100 rounded px-1.5 py-0.5">1 PC = 1 agent</span></div>
                  <div className="text-xs text-gray-600 mb-2">Agent installs on each PC. Scans only that PC's local OS settings (registry, secedit, etc.).</div>
                  <div className="text-[11px] text-gray-500 pt-1.5 border-t border-gray-200">Best for: Windows / Linux PCs &amp; servers</div>
                </button>

                <button
                  onClick={() => setAgentMode('collector')}
                  className={`text-left p-3 rounded-lg border-2 transition ${
                    agentMode === 'collector' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5"><span className="text-xl">🌐</span><span className="font-semibold text-sm">Collector</span><span className="ml-auto text-[10px] text-blue-700 bg-blue-100 rounded px-1.5 py-0.5">1 VM = many</span></div>
                  <div className="text-xs text-gray-600 mb-2">Agent installs on 1 VM. SSH-es / queries dozens of network devices using stored credentials.</div>
                  <div className="text-[11px] text-gray-500 pt-1.5 border-t border-gray-200">Best for: Cisco / Oracle / AWS</div>
                </button>
              </div>
            </>
          )}

          {/* ─── STEP 3: ENROLLMENT METHOD ─── */}
          {step === 'enrollment_method' && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">How many agents do you need?</h3>
              <p className="text-xs text-gray-500 mb-3">
                {agentMode === 'endpoint'
                  ? 'One token per PC. For 500 PCs you get 500 unique tokens.'
                  : 'One token per collector VM. Usually you need very few.'}
              </p>
              {/* Smart recommendations: Collector typically needs Single (one
                  jump-host scanning many devices); Endpoint typically needs Bulk
                  (per-host install via GPO). We badge the recommended path and
                  fade the less common one, but never hard-disable — there are
                  legitimate edge cases (multi-collector banks, 1-PC test). */}
              {(() => {
                const recForCollector = 'single' as const;
                const recForEndpoint = 'bulk' as const;
                const recommended = agentMode === 'collector' ? recForCollector : recForEndpoint;
                const cardStyle = (kind: EnrollMethod) => {
                  const isSelected = enrollMethod === kind;
                  const isRec = kind === recommended;
                  const isFaded = kind !== recommended && kind !== 'discovery' && !isSelected;
                  if (isSelected) return 'border-blue-500 bg-blue-50';
                  if (isRec) return 'border-green-400 bg-green-50/40 hover:border-green-500';
                  if (isFaded) return 'border-gray-200 bg-gray-50/60 opacity-70 hover:opacity-100 hover:border-gray-400';
                  return 'border-gray-200 hover:border-gray-300';
                };
                const RecBadge = () => (
                  <span className="ml-auto text-[10px] text-green-700 bg-green-100 border border-green-200 rounded px-1.5 py-0.5">Recommended</span>
                );
                return (
                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      onClick={() => setEnrollMethod('single')}
                      className={`text-left p-3 rounded-lg border-2 transition ${cardStyle('single')}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">👤</span>
                        <span className="font-semibold text-sm">Single</span>
                        {recommended === 'single' && <RecBadge />}
                      </div>
                      <div className="text-xs text-gray-600 mb-1.5">One agent, one token. Manual install on one target.</div>
                      <div className="text-[10px] text-gray-500 pt-1.5 border-t border-gray-200">
                        {agentMode === 'collector' ? '1 collector VM scans many devices' : 'For a single test PC'}
                      </div>
                    </button>

                    <button
                      onClick={() => setEnrollMethod('bulk')}
                      className={`text-left p-3 rounded-lg border-2 transition ${cardStyle('bulk')}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">⚡</span>
                        <span className="font-semibold text-sm">Bulk paste</span>
                        {recommended === 'bulk' && <RecBadge />}
                      </div>
                      <div className="text-xs text-gray-600 mb-1.5">Paste 100s of hostnames. Backend returns CSV of tokens.</div>
                      <div className="text-[10px] text-gray-500 pt-1.5 border-t border-gray-200">
                        {agentMode === 'endpoint' ? '500 PCs via GPO / SCCM / Ansible' : 'Multi-collector setup (rare)'}
                      </div>
                    </button>

                    <button
                      onClick={() => setEnrollMethod('discovery')}
                      className={`text-left p-3 rounded-lg border-2 transition ${cardStyle('discovery')}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">🔍</span>
                        <span className="font-semibold text-sm">From Discovery</span>
                      </div>
                      <div className="text-xs text-gray-600 mb-1.5">Network scan first → reachable hostnames brought here.</div>
                      <div className="text-[10px] text-gray-500 pt-1.5 border-t border-gray-200">Best for: unknown networks</div>
                    </button>
                  </div>
                );
              })()}
            </>
          )}

          {/* ─── STEP 4: CONFIGURE ─── */}
          {step === 'configure' && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Configure</h3>
              <p className="text-xs text-gray-500 mb-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 bg-gray-100 rounded">{method === 'agent' ? 'With Agent' : 'Agentless'}</span>
                  {agentMode && <><span>›</span><span className="px-1.5 py-0.5 bg-gray-100 rounded">{agentMode}</span></>}
                  {enrollMethod && <><span>›</span><span className="px-1.5 py-0.5 bg-gray-100 rounded">{enrollMethod}</span></>}
                </span>
              </p>

              {enrollMethod === 'single' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Agent name</label>
                    <input
                      type="text"
                      value={singleName}
                      onChange={(e) => setSingleName(e.target.value)}
                      placeholder={agentMode === 'collector' ? 'e.g. cisco-collector-vm' : 'e.g. DC-01'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Target OS</label>
                    <select
                      value={osFamily}
                      onChange={(e) => setOsFamily(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="windows">Windows</option>
                      <option value="linux">Linux</option>
                      <option value="macos">macOS</option>
                    </select>
                  </div>
                </div>
              )}

              {enrollMethod === 'bulk' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Hostnames</label>
                    <textarea
                      value={bulkHostnames}
                      onChange={(e) => setBulkHostnames(e.target.value)}
                      rows={7}
                      placeholder={'HASSAN-PC01\nAISHA-PC02\nAHMED-PC03\n…'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {bulkHostnames.split(/[\n,]/).map(s => s.trim()).filter(Boolean).length} hostnames detected
                      {discoveryPrefill?.hostnames?.length ? ' (prefilled from Discovery)' : ''}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Target OS</label>
                    <select
                      value={osFamily}
                      onChange={(e) => setOsFamily(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="windows">Windows</option>
                      <option value="linux">Linux</option>
                      <option value="macos">macOS</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── STEP 5: RESULT ─── */}
          {step === 'result' && singleResult && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">✅ Agent #{singleResult.agent_id} enrolled</h3>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 my-3">
                ⚠ This install command contains a one-time token. Copy it now — it can't be retrieved later.
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-700">Windows (PowerShell, run as Administrator):</label>
                    <button onClick={() => copy(singleResult.install_command_windows, 'win')} className="text-xs text-blue-600 hover:underline">
                      {copied === 'win' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-green-300 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {singleResult.install_command_windows}
                  </pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-700">Linux (bash, run as root):</label>
                    <button onClick={() => copy(singleResult.install_command_linux, 'lin')} className="text-xs text-blue-600 hover:underline">
                      {copied === 'lin' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-green-300 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {singleResult.install_command_linux}
                  </pre>
                </div>
              </div>
            </>
          )}

          {step === 'result' && bulkResult && (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900">✅ {bulkResult.count} agents enrolled</h3>
                <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">⚠ Tokens shown ONCE</span>
              </div>

              {/* Enrolled tokens — compact, scroll if long */}
              <div className="border border-gray-200 rounded-md overflow-hidden mb-3">
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600 sticky top-0">
                      <tr>
                        <th className="text-left px-2.5 py-1.5">Hostname</th>
                        <th className="text-left px-2.5 py-1.5 w-16">ID</th>
                        <th className="text-left px-2.5 py-1.5">Token (prefix)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.agents.map(a => (
                        <tr key={a.agent_id} className="border-t border-gray-100">
                          <td className="px-2.5 py-1 font-mono">{a.hostname}</td>
                          <td className="px-2.5 py-1">{a.agent_id}</td>
                          <td className="px-2.5 py-1 font-mono text-gray-500">{a.enrollment_token.slice(0, 24)}…</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* "You do this" vs "automatic" — clearly separated. */}
              <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <div className="text-xs font-semibold text-gray-900">Mass-deploy in 3 manual steps + 1 automatic</div>
                  <div className="text-[11px] text-gray-500">Compliverse can't push to your PCs directly — your Windows AD does that. Set it up once, then it's hands-free.</div>
                </div>
                <div className="divide-y divide-gray-100">
                  <div className="flex items-start gap-2.5 px-3 py-2">
                    <span className="flex-none w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center">1</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900">Download 3 files</div>
                      <div className="text-[11px] text-gray-600">CSV (tokens), the agent installer, and the GPO deploy script.</div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <button onClick={downloadCsv} className="px-2 py-0.5 text-[11px] bg-green-600 text-white rounded hover:bg-green-700">📥 enrollments.csv</button>
                        <a href="/grc/agent/install.exe" className="px-2 py-0.5 text-[11px] bg-gray-700 text-white rounded hover:bg-gray-800" download>📥 ComplyverseAgent.exe</a>
                        <button onClick={downloadGpoScript} className="px-2 py-0.5 text-[11px] bg-gray-700 text-white rounded hover:bg-gray-800">📥 Deploy-ComplyverseAgent.ps1</button>
                      </div>
                    </div>
                    <span className="flex-none text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">You</span>
                  </div>

                  <div className="flex items-start gap-2.5 px-3 py-2">
                    <span className="flex-none w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center">2</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900">Drop all 3 on your AD file share</div>
                      <div className="text-[11px] text-gray-600">
                        e.g. <code className="bg-gray-100 px-1 rounded">\\fileserver\compliverse\</code>. Permissions: only Domain Computers + Domain Admins.
                      </div>
                    </div>
                    <span className="flex-none text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">You</span>
                  </div>

                  <div className="flex items-start gap-2.5 px-3 py-2">
                    <span className="flex-none w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center">3</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900">Configure AD GPO Startup script</div>
                      <div className="text-[11px] text-gray-600">
                        Group Policy Mgmt Console →{' '}
                        <em>Computer Configuration › Policies › Windows Settings › Scripts › Startup</em> →
                        point to the <code className="bg-gray-100 px-1 rounded">.ps1</code> from step 2.
                      </div>
                    </div>
                    <span className="flex-none text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">You</span>
                  </div>

                  <div className="flex items-start gap-2.5 px-3 py-2 bg-green-50/50">
                    <span className="flex-none w-5 h-5 rounded-full bg-green-600 text-white text-[11px] font-semibold flex items-center justify-center">✓</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900">On next reboot — each PC installs itself</div>
                      <div className="text-[11px] text-gray-600">
                        GPO runs the script under SYSTEM, the script reads that PC's row from
                        the CSV, fires the installer with that token, the agent registers and
                        comes online. Repeat <em>never</em> — new PCs auto-enroll too.
                      </div>
                    </div>
                    <span className="flex-none text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Auto</span>
                  </div>
                </div>
              </div>

              {/* "GPO kya hai" inline help — one-line answer for non-AD admins. */}
              <details className="text-[11px] text-gray-600 mb-1">
                <summary className="cursor-pointer hover:text-gray-900">What is GPO? Who runs it? Why isn't it automatic from here?</summary>
                <p className="mt-2 pl-4 leading-relaxed">
                  <strong>Group Policy Objects (GPO)</strong> are a feature of Microsoft Active
                  Directory — they let one AD admin push settings (or run scripts) on every
                  PC that joins the domain. Compliverse is a SaaS, so it can't reach into
                  your bank's network and install anything on PCs directly. We give you the
                  installer + the script + the tokens; your AD admin wires those into GPO
                  once. After that AD handles the "push" — no Compliverse-side action
                  needed when new PCs join.
                </p>
              </details>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between gap-2 bg-gray-50 rounded-b-xl">
          <div>
            {step !== 'method' && step !== 'result' && (
              <button onClick={goBack} className="text-sm text-gray-600 hover:text-gray-900">
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-white">
              {step === 'result' ? 'Close' : 'Cancel'}
            </button>
            {step !== 'configure' && step !== 'result' && (
              <button
                onClick={onNext}
                disabled={!canNext()}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Next →
              </button>
            )}
            {step === 'configure' && (
              <button
                onClick={onSubmit}
                disabled={
                  (enrollMethod === 'single' && !singleName.trim()) ||
                  (enrollMethod === 'bulk' && !bulkHostnames.trim()) ||
                  singleMut.isPending || bulkMut.isPending
                }
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {(singleMut.isPending || bulkMut.isPending) ? 'Generating…' : enrollMethod === 'bulk' ? 'Generate tokens →' : 'Generate token →'}
              </button>
            )}
            {step === 'result' && bulkResult && (
              <button onClick={downloadCsv} className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700">
                📥 Download CSV
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
