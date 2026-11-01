'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { advisoriesApi } from '@/cyber-assurance/lib/api';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { AdvisoryView } from '../_components/ui';

interface CveRow {
  cve_id: string;
  affected_product: string;
  affected_versions: string;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export default function NewAdvisoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [externalId, setExternalId] = useState('');
  const [severity, setSeverity] = useState('critical');
  const [url, setUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [cves, setCves] = useState<CveRow[]>([{ cve_id: '', affected_product: '', affected_versions: '' }]);

  const createMutation = useMutation({
    mutationFn: () =>
      advisoriesApi.create({
        title: title.trim(),
        external_id: externalId.trim() || undefined,
        severity,
        url: url.trim() || undefined,
        summary: summary.trim() || undefined,
        cves: cves
          .filter((c) => c.cve_id.trim())
          .map((c) => ({
            cve_id: c.cve_id.trim(),
            affected_product: c.affected_product.trim() || undefined,
            affected_versions: c.affected_versions.trim() || undefined,
          })),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['advisories'] });
      const created = res.data as AdvisoryView;
      router.push(`/cyber-assurance/advisories/${created.id}`);
    },
  });

  const updateCve = (idx: number, field: keyof CveRow, value: string) => {
    setCves((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  const canSubmit = title.trim().length > 0 && cves.some((c) => c.cve_id.trim());

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold cw-text-default">New Advisory</h1>
        <p className="text-xs cw-text-muted">
          Record an advisory and the CVEs it names. Each CVE is matched against your asset inventory.
        </p>
      </div>

      <div className="cw-card space-y-4 p-5">
        <div>
          <label className="block text-xs font-semibold cw-text-muted mb-1">Title *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Critical PHP Vulnerabilities (Unauthenticated RCE)"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold cw-text-muted mb-1">Advisory ID</label>
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="NCA-19.211026"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold cw-text-muted mb-1">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold cw-text-muted mb-1">Source URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold cw-text-muted mb-1">Summary</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold cw-text-muted">CVEs *</label>
            <button
              onClick={() => setCves((prev) => [...prev, { cve_id: '', affected_product: '', affected_versions: '' }])}
              className="btn-secondary flex items-center gap-1 text-xs"
            >
              <Plus size={14} /> Add CVE
            </button>
          </div>
          <div className="space-y-2">
            {cves.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  value={c.cve_id}
                  onChange={(e) => updateCve(idx, 'cve_id', e.target.value)}
                  placeholder="CVE-2026-109618"
                  className="w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
                />
                <input
                  value={c.affected_product}
                  onChange={(e) => updateCve(idx, 'affected_product', e.target.value)}
                  placeholder="product (e.g. php)"
                  className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
                />
                <input
                  value={c.affected_versions}
                  onChange={(e) => updateCve(idx, 'affected_versions', e.target.value)}
                  placeholder="versions (e.g. < 8.2.35)"
                  className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm cw-text-default"
                />
                <button
                  onClick={() => setCves((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-2 rounded-lg cw-text-muted hover:text-red-600 hover:bg-[var(--color-hover)]"
                  title="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {createMutation.isError && (
          <p className="text-sm text-red-600">Failed to create advisory. Check the fields and try again.</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={() => router.push('/cyber-assurance/advisories')} className="btn-secondary">Cancel</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {createMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
            Create Advisory
          </button>
        </div>
      </div>
    </div>
  );
}
