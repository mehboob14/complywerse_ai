'use client';

// FrameworkJourneyPicker
// ─────────────────────────────────────────────────────────────────────────
// Compact "Start Journey" launcher that lives in the FrameworksTabs row.
//   1. Small button (Rocket icon + label + chevron) anchors the launcher.
//   2. Click opens a popover with a search box + grouped framework list.
//   3. Selecting a framework closes the popover and opens the detail modal
//      (overview metadata + target date + Start Journey + Cancel).

import { useState, useMemo, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Play, Calendar, Loader2, Rocket, ChevronRight, AlertCircle,
  X, Shield, Eye, ArrowRight, Target,
  CheckCircle2, Tag, Search, BookOpen, FileText, ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import { certificationsApi } from '@/lib/api';

interface FrameworkOption {
  id: number;
  name: string;
  version?: string;
  controls_count?: number;
  classification?: string | null;
  framework_type?: string;
  upload_status?: string;
  framework_purpose?: string;
  framework_scope?: string;
  framework_objectives?: string[];
  certification_body?: string;
  certification_validity_period?: string;
  regulatory_authority?: string;
  compliance_deadline?: string;
}

interface Props {
  frameworks: FrameworkOption[];
  activeJourneyFrameworkIds: Set<string>;
  stripCertificationPostfix: (s?: string) => string;
}

export function FrameworkJourneyPicker({
  frameworks,
  activeJourneyFrameworkIds,
  stripCertificationPostfix,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [modalFramework, setModalFramework] = useState<FrameworkOption | null>(null);
  const [targetDate, setTargetDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const eligible = useMemo(() => {
    return frameworks.filter((f) => {
      const status = (f.upload_status || '').toLowerCase();
      const isReady = ['completed', 'published', 'parsed', 'classified'].includes(status);
      const inJourney = activeJourneyFrameworkIds.has(String(f.id));
      return isReady && !inJourney;
    });
  }, [frameworks, activeJourneyFrameworkIds]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (f: FrameworkOption) => {
      if (!q) return true;
      return [
        f.name,
        stripCertificationPostfix(f.name),
        f.framework_type,
        f.classification,
        f.regulatory_authority,
        f.certification_body,
      ]
        .filter(Boolean)
        .some((v) => v!.toString().toLowerCase().includes(q));
    };

    const cls = (target: string) =>
      eligible.filter((f) => (f.classification || '').toLowerCase() === target && matches(f));
    const certs = cls('certification');
    const comps = cls('compliance');
    const other = eligible.filter(
      (f) => !['certification', 'compliance'].includes((f.classification || '').toLowerCase()) && matches(f),
    );

    return [
      { label: 'Certification', icon: BookOpen, frameworks: certs },
      { label: 'Compliance', icon: FileText, frameworks: comps },
      { label: 'Other', icon: Tag, frameworks: other },
    ].filter((g) => g.frameworks.length > 0);
  }, [eligible, search, stripCertificationPostfix]);

  // Outside-click + Escape close
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    // Auto-focus the search input when popover opens
    requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handlePick = (f: FrameworkOption) => {
    setOpen(false);
    setSearch('');
    setModalFramework(f);
  };

  const closeModal = () => {
    setModalFramework(null);
    setTargetDate('');
    setError(null);
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!modalFramework) throw new Error('Pick a framework first');
      const name = stripCertificationPostfix(modalFramework.name) || modalFramework.name;
      const body: { framework_id: number; name: string; target_date?: string } = {
        framework_id: modalFramework.id,
        name,
      };
      if (targetDate) body.target_date = targetDate;
      return await certificationsApi.create(body);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['certifications'] });
      queryClient.invalidateQueries({ queryKey: ['compliance-frameworks-aggregate'] });
      const journeyId = res.data?.id;
      if (journeyId) router.push(`/frameworks/${journeyId}`);
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err?.response?.data?.detail || err?.message || 'Failed to start journey');
      setTimeout(() => setError(null), 5000);
    },
  });

  const minDate = new Date().toISOString().split('T')[0];

  if (eligible.length === 0) return null;

  return (
    <>
      <div className="relative">
        <button
          ref={buttonRef}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 ${
            open ? 'border-slate-400 ring-2 ring-primary-500/15' : 'border-slate-300 hover:border-slate-400'
          }`}
        >
          <span>Onboard Framework</span>
          <span className="h-3 w-px bg-slate-200" aria-hidden />
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div
            ref={panelRef}
            className="absolute left-0 top-full z-40 mt-1.5 w-[340px] rounded-xl border border-slate-200 bg-white shadow-xl"
            role="dialog"
          >
            {/* Search */}
            <div className="border-b border-slate-100 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search frameworks…"
                  className="w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 py-1.5 text-xs text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
            </div>

            {/* Grouped list */}
            <div className="max-h-[320px] overflow-y-auto p-1">
              {groups.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-slate-400">
                  No matching frameworks
                </div>
              ) : (
                groups.map((g) => {
                  const GroupIcon = g.icon;
                  return (
                    <div key={g.label} className="py-1">
                      <div className="sticky top-0 z-10 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <GroupIcon className="h-2.5 w-2.5" />
                        {g.label}
                        <span className="ml-auto text-slate-300">{g.frameworks.length}</span>
                      </div>
                      {g.frameworks.map((f) => {
                        const display = stripCertificationPostfix(f.name) || f.name;
                        return (
                          <button
                            key={f.id}
                            onClick={() => handlePick(f)}
                            className="group w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium text-slate-800 group-hover:text-primary-700">
                                {display}
                              </span>
                              {f.controls_count != null && (
                                <span className="rounded bg-slate-100 px-1 py-px text-[9px] font-medium text-slate-600 shrink-0">
                                  {f.controls_count}
                                </span>
                              )}
                            </div>
                            {f.version && (
                              <div className="mt-0.5 truncate text-[10px] text-slate-400">
                                v{f.version}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {modalFramework && (
        <FrameworkStartModal
          framework={modalFramework}
          targetDate={targetDate}
          setTargetDate={setTargetDate}
          minDate={minDate}
          error={error}
          isStarting={startMutation.isPending}
          onCancel={closeModal}
          onStart={() => startMutation.mutate()}
          stripCertificationPostfix={stripCertificationPostfix}
        />
      )}
    </>
  );
}

// ─── Detail Modal ───────────────────────────────────────────────────────
function FrameworkStartModal({
  framework, targetDate, setTargetDate, minDate, error, isStarting,
  onCancel, onStart, stripCertificationPostfix,
}: {
  framework: FrameworkOption;
  targetDate: string;
  setTargetDate: (v: string) => void;
  minDate: string;
  error: string | null;
  isStarting: boolean;
  onCancel: () => void;
  onStart: () => void;
  stripCertificationPostfix: (s?: string) => string;
}) {
  const displayName = stripCertificationPostfix(framework.name) || framework.name;
  const cls = (framework.classification || '').toLowerCase();
  const isCert = cls === 'certification';
  const isComp = cls === 'compliance';

  const meta: Array<{ icon: React.ElementType; label: string; value: string }> = [];
  if (framework.framework_type) meta.push({ icon: Tag, label: 'Type', value: framework.framework_type.toUpperCase() });
  if (framework.version) meta.push({ icon: Tag, label: 'Version', value: framework.version });
  if (framework.controls_count != null) meta.push({ icon: Shield, label: 'Controls', value: String(framework.controls_count) });
  if (framework.certification_body) meta.push({ icon: BookOpen, label: 'Certifying Body', value: framework.certification_body });
  if (framework.regulatory_authority) meta.push({ icon: FileText, label: 'Regulator', value: framework.regulatory_authority });
  if (framework.certification_validity_period) meta.push({ icon: Calendar, label: 'Validity', value: framework.certification_validity_period });
  if (framework.compliance_deadline) meta.push({ icon: Calendar, label: 'Deadline', value: framework.compliance_deadline });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5 bg-primary-50/60">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-sm ring-1 ${
              isCert
                ? 'bg-emerald-50 ring-emerald-200 text-emerald-700'
                : isComp
                  ? 'bg-primary-50 ring-primary-200 text-primary-700'
                  : 'bg-slate-50 ring-slate-200 text-slate-700'
            }`}>
              <Rocket className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 truncate">{displayName}</h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {framework.version && (
                  <span className="text-[11px] text-slate-500">v{framework.version}</span>
                )}
                {cls && (
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase ${
                    isCert
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-primary-200 bg-primary-50 text-primary-700'
                  }`}>
                    {cls}
                  </span>
                )}
                {framework.controls_count != null && (
                  <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                    <Shield className="h-2.5 w-2.5" />
                    {framework.controls_count} controls
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {meta.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              {meta.map((m, i) => {
                const Icon = m.icon;
                return (
                  <div key={i} className="min-w-0">
                    <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                      <Icon className="h-2.5 w-2.5" />
                      {m.label}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-slate-800 truncate" title={m.value}>
                      {m.value}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {framework.framework_purpose && (
            <div>
              <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <Target className="h-3 w-3" /> Purpose
              </h4>
              <p className="text-xs leading-relaxed text-slate-700">{framework.framework_purpose}</p>
            </div>
          )}

          {framework.framework_scope && (
            <div>
              <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <Eye className="h-3 w-3" /> Scope
              </h4>
              <p className="text-xs leading-relaxed text-slate-700">{framework.framework_scope}</p>
            </div>
          )}

          {framework.framework_objectives && framework.framework_objectives.length > 0 && (
            <div>
              <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <CheckCircle2 className="h-3 w-3" /> Key Objectives
              </h4>
              <ul className="space-y-1">
                {framework.framework_objectives.slice(0, 6).map((obj, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary-500" />
                    <span>{obj}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 pt-1">
            <Link
              href={`/frameworks/overview/${framework.id}`}
              className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 transition-all hover:border-primary-300 hover:shadow-sm"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 ring-1 ring-slate-200">
                <Eye className="h-3.5 w-3.5 text-slate-600" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-800 group-hover:text-primary-700">Full Overview</div>
                <div className="text-[10px] text-slate-500">Classification, phases, artifacts</div>
              </div>
              <ArrowRight className="h-3 w-3 text-slate-300 group-hover:text-primary-500" strokeWidth={1.75} />
            </Link>
            <Link
              href={`/controls?framework=${framework.id}`}
              className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 transition-all hover:border-primary-300 hover:shadow-sm"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">
                <Shield className="h-3.5 w-3.5 text-primary-700" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-800 group-hover:text-primary-700">Browse Controls</div>
                <div className="text-[10px] text-slate-500">{framework.controls_count ?? '—'} requirements</div>
              </div>
              <ArrowRight className="h-3 w-3 text-slate-300 group-hover:text-primary-500" strokeWidth={1.75} />
            </Link>
          </div>

          <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-3">
            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              <Calendar className="h-3 w-3" strokeWidth={1.75} /> Target Completion Date
              <span className="ml-1 font-normal normal-case text-slate-400">(optional)</span>
            </label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.75} />
              <input
                type="date"
                value={targetDate}
                min={minDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-2 py-2 text-xs text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              We&apos;ll use this to compute due-date warnings and the readiness timeline.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3 bg-slate-50/60">
          <button
            onClick={onCancel}
            disabled={isStarting}
            className="rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onStart}
            disabled={isStarting}
            className="group inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-[color:var(--color-on-base,#0a0a0a)] shadow-sm transition-all hover:bg-primary-700 hover:shadow-md hover:translate-y-[-1px] disabled:bg-slate-300 disabled:translate-y-0 disabled:shadow-none disabled:cursor-not-allowed"
          >
            {isStarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Start Journey
            {!isStarting && (
              <ChevronRight className="h-3 w-3 transition-transform group-enabled:group-hover:translate-x-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
