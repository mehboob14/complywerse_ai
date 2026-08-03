'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi } from '@/lib/api';

type Job = {
  id: number;
  original_filename: string;
  benchmark_label: string | null;
  status: string;
  page_count: number | null;
  rules_extracted: number;
  rules_inserted: number;
  rules_updated: number;
  rules_flagged: number;
  rules_toc_rejected: number;
  ocr_pages: number;
  error_text: string | null;
  extraction_log: Array<Record<string, unknown>>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

type ReviewPlugin = {
  id: number;
  rule_id: string;
  title: string;
  severity: string;
  runner_type: string;
  confidence_score: number | null;
  level: string | null;
  audit_steps_text: string | null;
  description: string | null;
  references_json: string[];
  cis_controls_json: string[];
  source_ingest_job_id: number | null;
  check_definition?: Record<string, unknown>;
  auto_generated_check?: boolean;
  rationale?: string | null;
  remediation?: string | null;
};

type EditorState = {
  title: string;
  severity: string;
  runner_type: string;
  check_definition: string; // raw JSON text
  description: string;
};

export default function CisIngestPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  // Which ingest job's review queue to show. `null` = all pending across the
  // tenant (legacy behaviour, kept so reviewers can still triage older runs).
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [expandedReviewId, setExpandedReviewId] = useState<number | null>(null);
  const [editors, setEditors] = useState<Record<number, EditorState>>({});
  const [editorErrors, setEditorErrors] = useState<Record<number, string>>({});

  const jobsQ = useQuery({
    queryKey: ['cis.ingest.jobs'],
    queryFn: async () => (await compliancePluginsApi.listIngestJobs()).data as { jobs: Job[] },
    refetchInterval: 5000,
  });
  const reviewQ = useQuery({
    queryKey: ['cis.review-queue', selectedJobId],
    queryFn: async () =>
      (
        await compliancePluginsApi.getReviewQueue(
          selectedJobId !== null ? { ingest_job_id: selectedJobId } : undefined,
        )
      ).data as { plugins: ReviewPlugin[]; total_pending?: number; limit?: number },
  });

  const uploadM = useMutation({
    mutationFn: (f: File) => compliancePluginsApi.ingestPdf(f),
    onSuccess: (resp) => {
      setSelected(null);
      if (fileRef.current) fileRef.current.value = '';
      // Auto-focus the freshly uploaded job so the queue only shows its rules.
      const newJobId = (resp?.data as { id?: number } | undefined)?.id;
      if (typeof newJobId === 'number') setSelectedJobId(newJobId);
      qc.invalidateQueries({ queryKey: ['cis.ingest.jobs'] });
      qc.invalidateQueries({ queryKey: ['cis.review-queue'] });
    },
  });
  const reviewM = useMutation({
    mutationFn: (args: {
      id: number;
      decision: 'approve' | 'reject';
      patch?: Parameters<typeof compliancePluginsApi.reviewPlugin>[2];
    }) => compliancePluginsApi.reviewPlugin(args.id, args.decision, args.patch),
    onSuccess: (_data, vars) => {
      setExpandedReviewId((cur) => (cur === vars.id ? null : cur));
      setEditors((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      setEditorErrors((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['cis.review-queue'] });
      qc.invalidateQueries({ queryKey: ['compliance-plugins.list'] });
    },
    onError: (err, vars) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        String(err);
      setEditorErrors((prev) => ({ ...prev, [vars.id]: msg }));
    },
  });

  const openEditor = (p: ReviewPlugin) => {
    if (expandedReviewId === p.id) {
      setExpandedReviewId(null);
      return;
    }
    setExpandedReviewId(p.id);
    setEditors((prev) => {
      if (prev[p.id]) return prev;
      return {
        ...prev,
        [p.id]: {
          title: p.title || '',
          severity: p.severity || 'medium',
          runner_type: p.runner_type || 'linux_ssh',
          check_definition: JSON.stringify(p.check_definition ?? {}, null, 2),
          description: p.description || '',
        },
      };
    });
  };

  const updateEditor = (id: number, patch: Partial<EditorState>) => {
    setEditors((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setEditorErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleApproveWithEdits = (p: ReviewPlugin) => {
    const ed = editors[p.id];
    if (!ed) {
      reviewM.mutate({ id: p.id, decision: 'approve' });
      return;
    }
    let parsedCheck: Record<string, unknown>;
    try {
      const trimmed = ed.check_definition.trim();
      parsedCheck = trimmed ? JSON.parse(trimmed) : {};
      if (typeof parsedCheck !== 'object' || Array.isArray(parsedCheck)) {
        throw new Error('check_definition must be a JSON object');
      }
    } catch (e) {
      setEditorErrors((prev) => ({
        ...prev,
        [p.id]: `Invalid JSON in check definition: ${(e as Error).message}`,
      }));
      return;
    }
    reviewM.mutate({
      id: p.id,
      decision: 'approve',
      patch: {
        title: ed.title,
        severity: ed.severity,
        runner_type: ed.runner_type,
        check_definition: parsedCheck,
        description: ed.description || null,
      },
    });
  };
  const reparseM = useMutation({
    mutationFn: (jobId: number) => compliancePluginsApi.reparseIngestJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cis.ingest.jobs'] });
      qc.invalidateQueries({ queryKey: ['cis.review-queue'] });
      qc.invalidateQueries({ queryKey: ['compliance-plugins.list'] });
    },
  });
  const deleteM = useMutation({
    mutationFn: (jobId: number) => compliancePluginsApi.deleteIngestJob(jobId),
    onSuccess: (_data, jobId) => {
      if (selectedJobId === jobId) setSelectedJobId(null);
      qc.invalidateQueries({ queryKey: ['cis.ingest.jobs'] });
      qc.invalidateQueries({ queryKey: ['cis.review-queue'] });
      qc.invalidateQueries({ queryKey: ['compliance-plugins.list'] });
    },
  });

  const selectedJob =
    selectedJobId !== null
      ? (jobsQ.data?.jobs ?? []).find((j) => j.id === selectedJobId) ?? null
      : null;

  // Helper: turn a Job row into a friendly progress bar.
  // The pipeline writes `extraction_log` entries with a `current_page` or
  // `current_rule` field every 25 items; if the latest entry has one of
  // those, we can compute an accurate %. While extraction is still
  // bootstrapping (no page_count yet) we render an indeterminate bar.
  function jobProgress(j: Job): { pct: number | null; label: string } {
    if (j.status === 'completed') return { pct: 100, label: 'Done' };
    if (j.status === 'failed')    return { pct: 100, label: 'Failed' };
    const lastLog = Array.isArray(j.extraction_log) && j.extraction_log.length > 0
      ? (j.extraction_log[j.extraction_log.length - 1] as Record<string, unknown>)
      : null;
    if (lastLog && typeof lastLog.current_rule === 'number' && typeof lastLog.total_rules === 'number' && lastLog.total_rules > 0) {
      const pct = Math.min(100, Math.round((lastLog.current_rule as number) / (lastLog.total_rules as number) * 100));
      return { pct, label: `Synthesizing checks · rule ${lastLog.current_rule} of ${lastLog.total_rules}` };
    }
    if (lastLog && typeof lastLog.current_page === 'number' && j.page_count) {
      const pct = Math.min(100, Math.round((lastLog.current_page as number) / j.page_count * 100));
      return { pct, label: `Extracting text · page ${lastLog.current_page} of ${j.page_count}` };
    }
    if (j.page_count && j.page_count > 0) {
      return { pct: null, label: `Processing ${j.page_count} pages…` };
    }
    return { pct: null, label: 'Starting extraction…' };
  }

  const runningJobs = (jobsQ.data?.jobs ?? []).filter((j) => j.status === 'running');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Import CIS Benchmark PDF</h1>
        <p className="text-sm text-gray-600 mt-1">
          Drop a PDF and the pipeline extracts every rule, synthesises check
          definitions, and queues them for your approval. <strong>No rule is
          enabled until you explicitly approve it.</strong>
        </p>
      </div>

      {/* Live progress card — only shown when a job is running */}
      {runningJobs.map((j) => {
        const { pct, label } = jobProgress(j);
        return (
          <section key={`progress-${j.id}`} className="bg-blue-50 border border-blue-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <svg className="animate-spin h-4 w-4 text-blue-700" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-blue-900">{j.original_filename}</div>
                <div className="text-xs text-blue-700">{label}</div>
              </div>
              {pct !== null && (
                <div className="text-2xl font-semibold text-blue-700 tabular-nums">{pct}%</div>
              )}
            </div>
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              {pct !== null ? (
                <div
                  className="h-full bg-blue-600 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              ) : (
                <div className="h-full bg-blue-600 animate-pulse" style={{ width: '40%' }} />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-blue-800">
              {j.page_count != null && <span>📄 {j.page_count} pages</span>}
              {j.ocr_pages > 0 && <span>🔍 {j.ocr_pages} OCR'd</span>}
              {j.rules_extracted > 0 && <span>📜 {j.rules_extracted} rules so far</span>}
            </div>
          </section>
        );
      })}

      {/* Upload widget — large drop zone with hover state */}
      <section
        className={`bg-white border-2 border-dashed rounded-xl transition-colors ${
          selected ? 'border-blue-400 bg-blue-50/30' : 'border-gray-300 hover:border-blue-300 hover:bg-blue-50/20'
        }`}
      >
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.92-.42A4.5 4.5 0 0117 16h-1m-4-3v8m0-8l-3 3m3-3l3 3" />
          </svg>
          <div className="mt-3 flex flex-col items-center gap-2">
            <label
              htmlFor="cis-pdf-input"
              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              Choose CIS Benchmark PDF
              <input
                id="cis-pdf-input"
                ref={fileRef}
                type="file"
                accept="application/pdf"
                data-testid="cis-pdf-input"
                onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
            <p className="text-xs text-gray-500">
              AWS · Ubuntu · Windows · Azure · GCP · Kubernetes — any CIS PDF. Max 50 MB.
            </p>
          </div>
          {selected && (
            <div className="mt-4 inline-flex items-center gap-3 bg-white border border-blue-200 rounded-lg px-4 py-2 shadow-sm">
              <span className="text-xl">📄</span>
              <div className="text-left">
                <div className="text-sm font-medium text-gray-900">{selected.name}</div>
                <div className="text-xs text-gray-500">{(selected.size / 1024 / 1024).toFixed(2)} MB</div>
              </div>
              <button
                data-testid="cis-pdf-upload"
                disabled={uploadM.isPending}
                onClick={() => selected && uploadM.mutate(selected)}
                className="ml-2 px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {uploadM.isPending ? 'Uploading…' : 'Start Extraction'}
              </button>
            </div>
          )}
          {uploadM.isError && (
            <p className="mt-3 text-sm text-red-600" data-testid="cis-pdf-error">
              Upload failed:{' '}
              {(uploadM.error as { response?: { data?: { detail?: string } } })?.response?.data
                ?.detail ?? String(uploadM.error)}
            </p>
          )}
        </div>
      </section>

      <section className="border rounded-lg p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Recent ingest jobs</h2>
          {selectedJobId !== null && (
            <button
              data-testid="cis-clear-job-filter"
              onClick={() => setSelectedJobId(null)}
              className="text-xs text-blue-600 hover:underline"
            >
              Show review queue for all jobs
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]" data-testid="cis-jobs-table">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2">File</th>
              <th>Benchmark</th>
              <th>Status</th>
              <th>Pages</th>
              <th>OCR</th>
              <th>Rules</th>
              <th>Flagged</th>
              <th>TOC rejected</th>
              <th>When</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(jobsQ.data?.jobs ?? []).length === 0 && (
              <tr>
                <td colSpan={10} className="py-4 text-center text-gray-400">
                  No jobs yet — upload a PDF above to begin.
                </td>
              </tr>
            )}
            {(jobsQ.data?.jobs ?? []).map((j) => {
              const isSelected = selectedJobId === j.id;
              return (
                <tr
                  key={j.id}
                  className={`border-b last:border-0 cursor-pointer hover:bg-gray-50 ${
                    isSelected ? 'bg-blue-50' : ''
                  }`}
                  data-testid={`cis-job-${j.id}`}
                  onClick={() => setSelectedJobId(isSelected ? null : j.id)}
                  title="Click to filter the review queue to this job"
                >
                  <td className="py-2 font-mono text-xs">{j.original_filename}</td>
                  <td className="text-xs">{j.benchmark_label ?? '—'}</td>
                  <td>
                    <span
                      className={
                        j.status === 'completed'
                          ? 'text-green-700'
                          : j.status === 'failed'
                          ? 'text-red-700'
                          : 'text-gray-700'
                      }
                    >
                      {j.status}
                    </span>
                  </td>
                  <td>{j.page_count ?? '—'}</td>
                  <td>{j.ocr_pages}</td>
                  <td>
                    <span className="text-xs">
                      {j.rules_inserted}+ / {j.rules_updated}↻
                    </span>
                  </td>
                  <td>{j.rules_flagged}</td>
                  <td className="text-xs text-gray-500" data-testid={`cis-job-${j.id}-toc`}>
                    {j.rules_toc_rejected ?? 0}
                  </td>
                  <td className="text-xs text-gray-500">
                    {j.completed_at ? new Date(j.completed_at).toLocaleString() : '—'}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      data-testid={`cis-job-${j.id}-reparse`}
                      onClick={(e) => {
                        e.stopPropagation();
                        reparseM.mutate(j.id);
                      }}
                      disabled={
                        (reparseM.isPending && reparseM.variables === j.id) ||
                        j.status === 'running'
                      }
                      title="Re-run extraction against the stored PDF bytes (no re-upload needed)."
                      className="px-2 py-1 mr-1 text-xs rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      {reparseM.isPending && reparseM.variables === j.id
                        ? 'Re-parsing…'
                        : 'Re-parse'}
                    </button>
                    <button
                      data-testid={`cis-job-${j.id}-delete`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `Delete ingest job #${j.id} (${j.original_filename}) and ALL ${
                              j.rules_extracted ?? 0
                            } rules extracted from it? Past run history will be kept (detached).`,
                          )
                        ) {
                          deleteM.mutate(j.id);
                        }
                      }}
                      disabled={deleteM.isPending && deleteM.variables === j.id}
                      className="px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      {deleteM.isPending && deleteM.variables === j.id
                        ? 'Deleting…'
                        : 'Delete'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      <section className="border rounded-lg p-4 bg-white">
        <h2 className="font-medium mb-3">
          Review queue ({reviewQ.data?.total_pending ?? reviewQ.data?.plugins?.length ?? 0})
          {(reviewQ.data?.total_pending ?? 0) > (reviewQ.data?.plugins?.length ?? 0) && (
            <span className="ml-2 text-xs font-normal text-amber-600">
              · showing first {reviewQ.data?.plugins?.length}
            </span>
          )}
          {selectedJob && (
            <span className="ml-2 text-xs font-normal text-gray-500">
              · scoped to{' '}
              <span className="font-mono">
                {selectedJob.benchmark_label ?? selectedJob.original_filename}
              </span>
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          {selectedJobId !== null
            ? 'Rules below are from the selected ingest job only. Click another row above (or "Show review queue for all jobs") to change the scope.'
            : 'These rules were extracted with low confidence (missing sections or auto-generated check). Click a job above to filter the queue to that upload.'}
        </p>
        <div className="space-y-3" data-testid="cis-review-list">
          {(reviewQ.data?.plugins ?? []).length === 0 && (
            <div className="text-sm text-gray-400">Nothing pending review.</div>
          )}
          {(reviewQ.data?.plugins ?? []).map((p) => {
            const isOpen = expandedReviewId === p.id;
            const ed = editors[p.id];
            const err = editorErrors[p.id];
            return (
              <div
                key={p.id}
                className="border rounded p-3 bg-white"
                data-testid={`cis-review-${p.id}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="text-left flex-1"
                    onClick={() => openEditor(p)}
                    data-testid={`cis-review-toggle-${p.id}`}
                  >
                    <div className="font-mono text-xs text-gray-500">
                      {p.rule_id} · {p.runner_type} · {p.severity}
                      {p.confidence_score !== null && (
                        <> · confidence {(p.confidence_score * 100).toFixed(0)}%</>
                      )}
                      {p.auto_generated_check && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 text-[10px] font-medium">
                          auto-generated
                        </span>
                      )}
                    </div>
                    <div className="font-medium">{p.title}</div>
                  </button>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditor(p)}
                      className="px-3 py-1 text-xs rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                    >
                      {isOpen ? 'Close editor' : 'Edit & approve'}
                    </button>
                    <button
                      data-testid={`cis-approve-${p.id}`}
                      onClick={() =>
                        isOpen ? handleApproveWithEdits(p) : reviewM.mutate({ id: p.id, decision: 'approve' })
                      }
                      disabled={reviewM.isPending && reviewM.variables?.id === p.id}
                      className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {reviewM.isPending && reviewM.variables?.id === p.id && reviewM.variables?.decision === 'approve'
                        ? 'Approving…'
                        : isOpen
                        ? 'Approve with edits'
                        : 'Approve'}
                    </button>
                    <button
                      data-testid={`cis-reject-${p.id}`}
                      onClick={() => reviewM.mutate({ id: p.id, decision: 'reject' })}
                      disabled={reviewM.isPending && reviewM.variables?.id === p.id}
                      className="px-3 py-1 text-xs rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {!isOpen && p.description && (
                  <p className="mt-2 text-xs text-gray-600 line-clamp-3">{p.description}</p>
                )}
                {isOpen && ed && (
                  <div className="mt-3 space-y-3 border-t pt-3" data-testid={`cis-editor-${p.id}`}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="text-xs">
                        <div className="text-gray-600 mb-1">Title</div>
                        <input
                          value={ed.title}
                          onChange={(e) => updateEditor(p.id, { title: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs">
                        <div className="text-gray-600 mb-1">Severity</div>
                        <select
                          value={ed.severity}
                          onChange={(e) => updateEditor(p.id, { severity: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="critical">Critical</option>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                      </label>
                      <label className="text-xs">
                        <div className="text-gray-600 mb-1">Runner</div>
                        <select
                          value={ed.runner_type}
                          onChange={(e) => updateEditor(p.id, { runner_type: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="linux_ssh">linux_ssh</option>
                          <option value="windows_winrm">windows_winrm</option>
                          <option value="aws_readonly">aws_readonly</option>
                        </select>
                      </label>
                    </div>
                    <label className="text-xs block">
                      <div className="text-gray-600 mb-1">
                        Check definition (JSON) — runs through the same safety filter as the JSON importer
                      </div>
                      <textarea
                        value={ed.check_definition}
                        onChange={(e) => updateEditor(p.id, { check_definition: e.target.value })}
                        spellCheck={false}
                        className="w-full h-56 font-mono text-xs border border-gray-300 rounded p-2"
                        data-testid={`cis-check-def-${p.id}`}
                      />
                    </label>
                    <label className="text-xs block">
                      <div className="text-gray-600 mb-1">Description (optional)</div>
                      <textarea
                        value={ed.description}
                        onChange={(e) => updateEditor(p.id, { description: e.target.value })}
                        rows={2}
                        className="w-full text-xs border border-gray-300 rounded p-2"
                      />
                    </label>
                    {p.audit_steps_text && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-600">
                          Original audit steps (extracted from PDF)
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded p-2 text-[11px] max-h-40 overflow-auto">
                          {p.audit_steps_text}
                        </pre>
                      </details>
                    )}
                    {err && (
                      <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                        {err}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
