'use client';

/**
 * Shared building blocks for the Controls module. Extracted verbatim from the
 * original monolithic `controls/page.tsx` so both the split-workbench (`/controls`)
 * and the analytics overview (`/controls/overview`) can import them without
 * duplication. No behaviour changes — same queries, mutations, and markup.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { controlsApi, evidenceApi } from '@/lib/api';
import { InlineLinkPicker } from '@/components/ui';
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  Paperclip,
  Link2,
  Link2Off,
  ExternalLink,
  Upload,
  Target,
} from 'lucide-react';

// ── Shared types ────────────────────────────────────────────────────────────
export interface FrameworkControl {
  id: number;
  control_id: string;
  original_reference: string | null;
  title: string;
  description: string | null;
  full_text: string | null;
  domain: string | null;
  category: string | null;
  is_mandatory: boolean;
  priority: string;
  // Native implementation-order tier (NDMO P1/P2/P3 → Year 1/2/3 roadmap) and
  // control-level prerequisite codes. Null/[] for frameworks without them.
  priority_level: string | null;
  dependencies: string[];
  version_history: Array<{ date?: string; version?: string }>;
  control_description: string | null;
  section_number: string | null;
  parent_section: string | null;
  ai_confidence: number | null;
  ai_notes: string | null;
  is_verified: boolean;
  framework_id: number;
  framework_name: string;
  framework_version: string | null;
  created_at: string | null;
  evidence_count: number;
  // Saved per-control evidence recommendations (seed shape: name/description/filetype).
  // Older callers used title/artifact_type, so both are accepted for safety.
  evidence_requirements: Array<{
    name?: string;
    title?: string;
    description?: string;
    filetype?: string;
    artifact_type?: string;
  }>;
}

export interface FrameworkSummary {
  id: number;
  name: string;
  version: string | null;
  framework_type: string | null;
  status: string;
  control_count: number;
}

export interface FrameworkControlsResponse {
  controls: FrameworkControl[];
  total: number;
  skip: number;
  limit: number;
}

export interface FrameworkSummaryResponse {
  frameworks: FrameworkSummary[];
  total_frameworks: number;
  total_controls: number;
}

export interface ControlImplStatus {
  status: string;
  assignee_name: string | null;
  implementation_date: string | null;
  verified_date: string | null;
}

export interface StatusSummary {
  total: number;
  verified: number;
  with_evidence: number;
  mandatory: number;
  by_priority: Record<string, number>;
  implementation: {
    tracked: boolean;
    by_status: Record<string, number>;
  };
  control_status: Record<string, ControlImplStatus>;
}

export interface FrameworkControlEvidenceLink {
  id: number;
  evidence_id: number;
  title?: string;
  description?: string;
  evidence_type?: string;
  status?: string;
  file_name?: string;
  linked_at?: string;
}

export interface EvidenceOption {
  id: number;
  name?: string;
  title?: string;
  file_name?: string;
  evidence_type?: string;
  status?: string;
}

// ── Linked-evidence section (link existing / upload new / unlink) ────────────
export function FrameworkControlEvidenceLinkSection({ controlId }: { controlId: number }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [searchEv, setSearchEv] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');

  const { data: linkedEvidence, isLoading: loadingLinked } = useQuery({
    queryKey: ['framework-control-evidence', controlId],
    queryFn: async () => {
      const res = await controlsApi.getFrameworkControlEvidence(controlId);
      return res.data as FrameworkControlEvidenceLink[];
    },
  });

  const { data: allEvidence, isLoading: evidenceLoading } = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => {
      const res = await evidenceApi.getAll();
      return res.data as unknown as EvidenceOption[];
    },
  });

  const linkMutation = useMutation({
    mutationFn: (evidenceId: number) =>
      controlsApi.linkFrameworkControlEvidence(controlId, { evidence_id: evidenceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-control-evidence', controlId] });
      queryClient.invalidateQueries({ queryKey: ['framework-controls'] });
      setShowPicker(false);
      setSearchEv('');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: number) => controlsApi.unlinkFrameworkControlEvidence(controlId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-control-evidence', controlId] });
      queryClient.invalidateQueries({ queryKey: ['framework-controls'] });
    },
  });

  const uploadAndLinkMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) {
        throw new Error('Please select a file to upload.');
      }

      const formData = new FormData();
      formData.append('name', uploadName.trim() || uploadFile.name);
      if (uploadDescription.trim()) {
        formData.append('description', uploadDescription.trim());
      }
      formData.append('file', uploadFile);

      const uploadRes = await evidenceApi.create(formData);
      const uploadedEvidenceId = uploadRes.data?.id;
      if (!uploadedEvidenceId) {
        throw new Error('Evidence uploaded but no evidence ID was returned.');
      }

      await controlsApi.linkFrameworkControlEvidence(controlId, { evidence_id: Number(uploadedEvidenceId) });
      return uploadedEvidenceId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-control-evidence', controlId] });
      queryClient.invalidateQueries({ queryKey: ['framework-controls'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-all'] });
      setShowUploader(false);
      setUploadError('');
      setUploadName('');
      setUploadDescription('');
      setUploadFile(null);
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail;
      setUploadError(typeof detail === 'string' ? detail : (error?.message || 'Failed to upload and link evidence.'));
    },
  });

  const linkedIds = new Set((linkedEvidence ?? []).map((l) => l.evidence_id));
  const evidencePickerItems = (allEvidence ?? [])
    .filter((ev) => !linkedIds.has(ev.id))
    .map((ev) => ({
      value: String(ev.id),
      label: ev.name || ev.title || ev.file_name || `Evidence #${ev.id}`,
      subLabel: ev.evidence_type,
    }));
  void searchEv; void setSearchEv; void showPicker; void setShowPicker;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-800">Linked Evidence</h3>
        <div className="flex items-center gap-2">
          <InlineLinkPicker
            triggerLabel="Link Existing"
            triggerIcon={<Link2 className="h-3 w-3" />}
            triggerClassName="flex items-center gap-1 rounded border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50"
            items={evidencePickerItems}
            isLoading={evidenceLoading || linkMutation.isPending}
            emptyText="No evidence available"
            searchPlaceholder="Search evidence"
            popoverWidth={320}
            onSelect={(value) => linkMutation.mutate(Number(value))}
          />
          <button
            type="button"
            onClick={() => {
              setShowUploader(!showUploader);
              setUploadError('');
            }}
            className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
          >
            <Upload className="h-3 w-3" />
            {showUploader ? 'Close Upload' : 'Upload New'}
          </button>
        </div>
      </div>

      {showUploader && (
        <form
          className="mb-4 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setUploadError('');
            uploadAndLinkMutation.mutate();
          }}
        >
          <input
            type="text"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="Evidence name (optional, file name will be used)"
            className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          <textarea
            value={uploadDescription}
            onChange={(e) => setUploadDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="file"
            required
            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            className="w-full text-xs text-slate-600 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-slate-700"
          />
          {uploadError && <p className="text-xs text-rose-600">{uploadError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploadAndLinkMutation.isPending}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {uploadAndLinkMutation.isPending ? 'Uploading...' : 'Upload & Link'}
            </button>
          </div>
        </form>
      )}

      {loadingLinked ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        </div>
      ) : (linkedEvidence ?? []).length === 0 ? (
        <p className="text-xs text-slate-500">No evidence linked yet.</p>
      ) : (
        <div className="space-y-2">
          {(linkedEvidence ?? []).map((lnk) => (
            <div
              key={lnk.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/evidence/${lnk.evidence_id}`}
                  className="block truncate text-xs font-medium text-primary-700 hover:underline"
                >
                  {lnk.title || lnk.file_name || `Evidence #${lnk.evidence_id}`}
                </Link>
                {lnk.evidence_type && (
                  <span className="text-[11px] text-slate-500">{lnk.evidence_type}</span>
                )}
              </div>
              <div className="ml-2 flex flex-shrink-0 items-center gap-1">
                <Link
                  href={`/evidence/${lnk.evidence_id}`}
                  className="rounded p-1 text-slate-400 hover:text-primary-600"
                  title="View evidence"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => unlinkMutation.mutate(lnk.id)}
                  disabled={unlinkMutation.isPending}
                  className="rounded p-1 text-slate-400 hover:text-rose-500"
                  title="Unlink"
                >
                  {unlinkMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2Off className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Native framework tree (NDMO-style): Domain -> Control -> Specification, with
// P1/P2/P3 implementation-order badges, a Year 1/2/3 phased filter, and the
// control-level dependency graph. Rendered for frameworks that carry
// `priority_level` (the NDMO 3-year roadmap model). Self-contained: its own
// query (fetches the full control set, unpaginated) and local UI state.
// ---------------------------------------------------------------------------
export const PL_META: Record<string, { year: number; label: string; badge: string; dot: string }> = {
  P1: { year: 1, label: 'Year 1', badge: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  P2: { year: 2, label: 'Year 2', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  P3: { year: 3, label: 'Year 3', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
};

export function PriorityLevelBadge({ level }: { level: string | null }) {
  if (!level) {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500" title="Not assessed by NDMO (NCA-governed)">
        N/A
      </span>
    );
  }
  const m = PL_META[level];
  const cls = m ? m.badge : 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`} title={m ? `Priority ${level} — implement by ${m.label}` : level}>
      {level}
    </span>
  );
}

export function DomainId({ code }: { code: string }) {
  const id = (code || '').split('.')[0] || '?';
  return (
    <span className="inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-md bg-primary-600 px-1.5 text-[11px] font-bold tracking-wide text-white">
      {id}
    </span>
  );
}

export function NativeFrameworkTree({ frameworkId }: { frameworkId: number }) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0); // 0 = all
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [openSpec, setOpenSpec] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['framework-controls-tree', frameworkId],
    queryFn: async () => {
      const res = await controlsApi.getFrameworkControls({
        framework_id: frameworkId, limit: 2000, sort_by: 'control_id', sort_order: 'asc',
      });
      return res.data as FrameworkControlsResponse;
    },
  });

  // Sort by row id = the framework's published/document order (seeded in
  // document order), so domains render as in the source (e.g. NDMO: Data
  // Governance first), not alphabetically by control code.
  const controls = useMemo(() => [...(data?.controls ?? [])].sort((a, b) => a.id - b.id), [data]);

  const grouped = useMemo(() => {
    const domains: { name: string; controls: { code: string; name: string; deps: string[]; specs: FrameworkControl[] }[] }[] = [];
    const dIdx = new Map<string, number>();
    const cIdx = new Map<string, number>();
    for (const c of controls) {
      const dn = c.domain || 'Uncategorized';
      if (!dIdx.has(dn)) { dIdx.set(dn, domains.length); domains.push({ name: dn, controls: [] }); }
      const di = dIdx.get(dn)!;
      const code = c.parent_section || c.control_id;
      const ckey = dn + '||' + code;
      if (!cIdx.has(ckey)) {
        // Control name: the flat `category` carries "DG.1: Strategy and Plan".
        const rawCat = c.category || '';
        const name = rawCat.includes(':') ? rawCat.split(':').slice(1).join(':').trim() : rawCat;
        cIdx.set(ckey, domains[di].controls.length);
        domains[di].controls.push({ code, name, deps: c.dependencies || [], specs: [] });
      }
      domains[di].controls[cIdx.get(ckey)!].specs.push(c);
    }
    return domains;
  }, [controls]);

  const counts = useMemo(() => {
    const c = { P1: 0, P2: 0, P3: 0, other: 0 };
    for (const x of controls) {
      if (x.priority_level === 'P1') c.P1++;
      else if (x.priority_level === 'P2') c.P2++;
      else if (x.priority_level === 'P3') c.P3++;
      else c.other++;
    }
    return c;
  }, [controls]);

  const included = useMemo(() => {
    const s = new Set<string>();
    if (phase >= 1) s.add('P1');
    if (phase >= 2) s.add('P2');
    if (phase >= 3) s.add('P3');
    return s;
  }, [phase]);

  const specVisible = (s: FrameworkControl) =>
    phase === 0 ? true : (s.priority_level ? included.has(s.priority_level) : false);

  const toggleDomain = (name: string) =>
    setOpenDomains((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const allDomainNames = grouped.map((d) => d.name);
  const allOpen = openDomains.size >= allDomainNames.length && allDomainNames.length > 0;

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const phaseChips: { v: 0 | 1 | 2 | 3; label: string; sub: string }[] = [
    { v: 0, label: 'All', sub: `${controls.length}` },
    { v: 1, label: 'Year 1', sub: `${counts.P1}` },
    { v: 2, label: 'Year 2', sub: `${counts.P1 + counts.P2}` },
    { v: 3, label: 'Year 3', sub: `${counts.P1 + counts.P2 + counts.P3}` },
  ];

  return (
    <div className="space-y-4">
      {/* Phased roadmap summary + filter */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-slate-700" />
          <h3 className="text-sm font-semibold text-slate-800">3-Year Implementation Roadmap</h3>
          <span className="text-xs text-slate-500">specifications scored 100% / 0%, cascaded to control → domain → entity</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phaseChips.map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => setPhase(p.v)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                phase === p.v
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{p.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${phase === p.v ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{p.sub}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />P1</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />P2</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />P3</span>
            {counts.other > 0 && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-300" />N/A ({counts.other})</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {grouped.length} domains · {controls.length} specifications
          {phase !== 0 && ` · showing ${phaseChips[phase].label} (${phaseChips[phase].sub})`}
        </p>
        <button
          type="button"
          onClick={() => setOpenDomains(allOpen ? new Set() : new Set(allDomainNames))}
          className="text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {/* Domain -> Control -> Specification tree */}
      <div className="space-y-2">
        {grouped.map((domain) => {
          const visibleControls = domain.controls
            .map((ctrl) => ({ ...ctrl, vspecs: ctrl.specs.filter(specVisible) }))
            .filter((ctrl) => ctrl.vspecs.length > 0);
          if (visibleControls.length === 0) return null;
          const specCount = visibleControls.reduce((n, c) => n + c.vspecs.length, 0);
          const domainCode = domain.controls[0]?.code || '';
          const isOpen = openDomains.has(domain.name);
          return (
            <div key={domain.name} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => toggleDomain(domain.name)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                {isOpen ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />}
                <DomainId code={domainCode} />
                <span className="flex-1 text-sm font-semibold text-slate-800">{domain.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {visibleControls.length} controls · {specCount} specs
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 px-3 pb-3 pt-1 sm:px-4">
                  {visibleControls.map((ctrl) => (
                    <div key={ctrl.code} className="mt-3 first:mt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-900">{ctrl.code}</span>
                        {ctrl.name && <span className="text-sm font-medium text-slate-700">{ctrl.name}</span>}
                        {ctrl.deps.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                            <Link2 className="h-3 w-3" />
                            depends on:
                            {ctrl.deps.map((d) => (
                              <span key={d} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{d}</span>
                            ))}
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 space-y-1 border-l-2 border-slate-100 pl-3">
                        {ctrl.vspecs.map((spec) => {
                          const isSpecOpen = openSpec === spec.id;
                          const specCode = spec.section_number || spec.original_reference || spec.control_id;
                          return (
                            <div key={spec.id} className="rounded-md">
                              <button
                                type="button"
                                onClick={() => setOpenSpec(isSpecOpen ? null : spec.id)}
                                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                              >
                                <PriorityLevelBadge level={spec.priority_level} />
                                <span className="mt-0.5 font-mono text-[11px] text-slate-500">{specCode}</span>
                                <span className="flex-1 text-sm text-slate-700">{spec.title}</span>
                                {isSpecOpen ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />}
                              </button>
                              {isSpecOpen && (
                                <div className="ml-2 mb-2 mt-1 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
                                  {spec.full_text || spec.description || 'No description provided.'}
                                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                                    {spec.priority_level && PL_META[spec.priority_level] && (
                                      <span>Priority {spec.priority_level} · implement by {PL_META[spec.priority_level].label}</span>
                                    )}
                                    <span>{spec.is_mandatory ? 'Mandatory' : 'Optional'}</span>
                                    <span className="inline-flex items-center gap-1">
                                      <Paperclip className="h-3 w-3" /> {spec.evidence_count} evidence
                                    </span>
                                    <Link
                                      href={`/evidence?control_id=${spec.id}`}
                                      className="text-primary-700 hover:underline"
                                    >
                                      Manage evidence
                                    </Link>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Figure-2 view: renders every control as the exact boxed "Control Structure
// Format" table from the NDMO v1.5 standard (§7, Figure 2):
//   Domain Name | Domain ID
//   Control Name | Control ID
//   Control Description
//   [ Specification # | Specification Name | Control Specification | Priority ]
//   Version History (Date | Version)
//   Dependencies
// Grouped by domain, with the same Year 1/2/3 phase filter.
// ---------------------------------------------------------------------------
export function Figure2View({ frameworkId }: { frameworkId: number }) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [openSpecs, setOpenSpecs] = useState<Set<number>>(new Set());
  const toggleSpec = (id: number) => setOpenSpecs((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['framework-controls-doc', frameworkId],
    queryFn: async () => {
      const res = await controlsApi.getFrameworkControls({
        framework_id: frameworkId, limit: 2000, sort_by: 'control_id', sort_order: 'asc',
      });
      return res.data as FrameworkControlsResponse;
    },
  });

  // Sort by row id = the framework's published/document order (seeded in
  // document order), so domains render as in the source (e.g. NDMO: Data
  // Governance first), not alphabetically by control code.
  const controls = useMemo(() => [...(data?.controls ?? [])].sort((a, b) => a.id - b.id), [data]);

  const grouped = useMemo(() => {
    const domains: { name: string; controls: {
      code: string; name: string; desc: string | null; deps: string[];
      versions: Array<{ date?: string; version?: string }>; specs: FrameworkControl[];
    }[] }[] = [];
    const dIdx = new Map<string, number>();
    const cIdx = new Map<string, number>();
    for (const c of controls) {
      const dn = c.domain || 'Uncategorized';
      if (!dIdx.has(dn)) { dIdx.set(dn, domains.length); domains.push({ name: dn, controls: [] }); }
      const di = dIdx.get(dn)!;
      const code = c.parent_section || c.control_id;
      const ckey = dn + '||' + code;
      if (!cIdx.has(ckey)) {
        const rawCat = c.category || '';
        const name = rawCat.includes(':') ? rawCat.split(':').slice(1).join(':').trim() : rawCat;
        cIdx.set(ckey, domains[di].controls.length);
        domains[di].controls.push({
          code, name, desc: c.control_description || null,
          deps: c.dependencies || [], versions: c.version_history || [], specs: [],
        });
      }
      domains[di].controls[cIdx.get(ckey)!].specs.push(c);
    }
    return domains;
  }, [controls]);

  const counts = useMemo(() => {
    const c = { P1: 0, P2: 0, P3: 0, other: 0 };
    for (const x of controls) {
      if (x.priority_level === 'P1') c.P1++;
      else if (x.priority_level === 'P2') c.P2++;
      else if (x.priority_level === 'P3') c.P3++;
      else c.other++;
    }
    return c;
  }, [controls]);

  const included = useMemo(() => {
    const s = new Set<string>();
    if (phase >= 1) s.add('P1');
    if (phase >= 2) s.add('P2');
    if (phase >= 3) s.add('P3');
    return s;
  }, [phase]);
  const specVisible = (s: FrameworkControl) =>
    phase === 0 ? true : (s.priority_level ? included.has(s.priority_level) : false);

  const toggleDomain = (name: string) =>
    setOpenDomains((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const allDomainNames = grouped.map((d) => d.name);
  const allOpen = openDomains.size >= allDomainNames.length && allDomainNames.length > 0;

  if (isLoading) {
    return <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }

  const phaseChips: { v: 0 | 1 | 2 | 3; label: string; sub: string }[] = [
    { v: 0, label: 'All', sub: `${controls.length}` },
    { v: 1, label: 'Year 1', sub: `${counts.P1}` },
    { v: 2, label: 'Year 2', sub: `${counts.P1 + counts.P2}` },
    { v: 3, label: 'Year 3', sub: `${counts.P1 + counts.P2 + counts.P3}` },
  ];

  return (
    <div className="space-y-4">
      {/* Phase filter */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-slate-700" />
          <h3 className="text-sm font-semibold text-slate-800">Control Structure (Figure 2 format) · 3-Year Roadmap</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phaseChips.map((p) => (
            <button key={p.v} type="button" onClick={() => setPhase(p.v)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                phase === p.v ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
              <span>{p.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${phase === p.v ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{p.sub}</span>
            </button>
          ))}
          <button type="button" onClick={() => setOpenDomains(allOpen ? new Set() : new Set(allDomainNames))}
            className="ml-auto text-xs font-medium text-slate-600 hover:text-slate-900">
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      {grouped.map((domain) => {
        const domainCode = (domain.controls[0]?.code || '').split('.')[0] || '?';
        const visibleControls = domain.controls
          .map((ctrl) => ({ ...ctrl, vspecs: ctrl.specs.filter(specVisible) }))
          .filter((ctrl) => ctrl.vspecs.length > 0);
        if (visibleControls.length === 0) return null;
        const isOpen = openDomains.has(domain.name);
        return (
          <div key={domain.name} className="space-y-3">
            <button type="button" onClick={() => toggleDomain(domain.name)}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-left hover:bg-slate-100">
              {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              <DomainId code={domainCode} />
              <span className="flex-1 text-sm font-semibold text-slate-800">{domain.name}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600">{visibleControls.length} controls</span>
            </button>

            {isOpen && visibleControls.map((ctrl) => (
              <div key={ctrl.code} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                {/* Identity block — all Figure-2 header fields, labelled */}
                <div className="border-b border-slate-100 bg-white px-5 py-4">
                  <div className="grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Domain Name</p>
                      <p className="mt-0.5 text-sm font-medium text-slate-800">{domain.name}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Domain ID</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-primary-700">{domainCode}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Control Name</p>
                      <p className="mt-0.5 text-sm font-medium text-slate-800">{ctrl.name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Control ID</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-primary-700">{ctrl.code}</p>
                    </div>
                  </div>
                  {ctrl.desc && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Control Description</p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{ctrl.desc}</p>
                    </div>
                  )}
                </div>

                {/* Specifications — scannable; click a row to reveal the
                    Control Specification text */}
                <div className="flex items-center justify-between px-5 pt-3 pb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Specifications</p>
                  <p className="text-[11px] text-slate-400">{ctrl.vspecs.length} · click to expand</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {ctrl.vspecs.map((s) => {
                    const isSpecOpen = openSpecs.has(s.id);
                    const specCode = s.section_number || s.original_reference || s.control_id;
                    return (
                      <div key={s.id}>
                        <button
                          type="button"
                          onClick={() => toggleSpec(s.id)}
                          className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50"
                        >
                          <span className="w-14 shrink-0 font-mono text-xs text-slate-400">{specCode}</span>
                          <span className="flex-1 truncate text-sm font-medium text-slate-800">{s.title}</span>
                          <PriorityLevelBadge level={s.priority_level} />
                          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-300 transition-transform ${isSpecOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isSpecOpen && (
                          <div className="px-5 pb-4 pl-[4.25rem]">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Control Specification</p>
                            <p className="rounded-lg bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-600 whitespace-pre-wrap">
                              {s.full_text || s.description || '—'}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Version History + Dependencies — labelled footer */}
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3 text-[12px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-semibold uppercase tracking-wide text-slate-400">Version History</span>
                    <span className="text-slate-600">
                      {ctrl.versions[0]?.date || '—'}{ctrl.versions[0]?.version ? ` · Version ${ctrl.versions[0].version}` : ''}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-semibold uppercase tracking-wide text-slate-400">Dependencies</span>
                    {ctrl.deps.length === 0 ? (
                      <span className="text-slate-400">None</span>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        {ctrl.deps.map((d) => (
                          <span key={d} className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">{d}</span>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Implementation-status pill (certification-journey status). Semantic tints only.
export const IMPL_STATUS_META: Record<string, { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'In progress', cls: 'bg-amber-50 text-amber-700' },
  implemented: { label: 'Implemented', cls: 'bg-primary-50 text-primary-700' },
  verified: { label: 'Verified', cls: 'bg-emerald-50 text-emerald-700' },
  not_applicable: { label: 'N/A', cls: 'bg-slate-100 text-slate-500' },
};
export function ImplStatusPill({ status }: { status: string }) {
  const m = IMPL_STATUS_META[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Control-health snapshot — a compact, on-brand tile strip driven by the new
// status-summary endpoint (guarded to {}). Verified % / evidence coverage % are
// endpoint-derived (not the paginated list). The implementation mini-bar only
// renders when the endpoint reports implementation.tracked.
// ---------------------------------------------------------------------------
const IMPL_BAR: { key: string; label: string; cls: string }[] = [
  { key: 'not_started', label: 'Not started', cls: 'bg-slate-300' },
  { key: 'in_progress', label: 'In progress', cls: 'bg-amber-400' },
  { key: 'implemented', label: 'Implemented', cls: 'bg-primary-400' },
  { key: 'verified', label: 'Verified', cls: 'bg-emerald-500' },
];
export function ControlHealthSnapshot({
  summary, totalFrameworks, fallbackTotal,
}: { summary?: Partial<StatusSummary>; totalFrameworks: number; fallbackTotal: number }) {
  const total = summary?.total ?? fallbackTotal ?? 0;
  const hasEndpoint = summary?.total != null;
  const verified = summary?.verified ?? 0;
  const withEvidence = summary?.with_evidence ?? 0;
  const mandatory = summary?.mandatory ?? 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const impl = summary?.implementation;
  const tracked = !!impl?.tracked;
  const byStatus = impl?.by_status ?? {};
  const implTotal = IMPL_BAR.reduce((s, b) => s + (byStatus[b.key] || 0), 0);

  const Tile = ({ value, label, tone }: { value: React.ReactNode; label: string; tone?: string }) => (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className={`text-xl font-bold ${tone || 'text-slate-900'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile value={total} label="Total controls" />
      <Tile value={totalFrameworks} label={totalFrameworks === 1 ? 'Framework' : 'Frameworks'} />
      <Tile value={hasEndpoint ? `${pct(verified)}%` : '—'} label="Verified" tone="text-emerald-600" />
      <Tile value={hasEndpoint ? `${pct(withEvidence)}%` : '—'} label="Evidence coverage" tone="text-primary-600" />
      <Tile value={hasEndpoint ? mandatory : '—'} label="Mandatory" tone="text-rose-600" />
      {tracked && implTotal > 0 ? (
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:col-span-3 lg:col-span-1">
          <p className="mb-1.5 text-xs font-medium text-slate-600">Implementation</p>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
            {IMPL_BAR.map((b) => {
              const n = byStatus[b.key] || 0;
              if (n === 0) return null;
              return <div key={b.key} className={b.cls} style={{ width: `${(n / implTotal) * 100}%` }} title={`${b.label}: ${n}`} />;
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {IMPL_BAR.map((b) => (
              <span key={b.key} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                <span className={`h-2 w-2 rounded-full ${b.cls}`} />{byStatus[b.key] || 0}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <Tile value={hasEndpoint && total > 0 ? `${pct(withEvidence)}%` : '—'} label="Coverage" tone="text-primary-600" />
      )}
    </div>
  );
}
