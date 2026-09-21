'use client';

/**
 * "Audit finding: CLDCA.01" — shown on an asset or vulnerability that a
 * register finding names, linking back to the issue. Renders nothing when no
 * finding points here or the viewer can't see issues.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { auditRegisterApi } from '@/lib/api';

type Tag = { issue_id: number; reference?: string; title?: string; report?: string; workflow_state?: string };

export function AuditFindingTags({ kind, recordId }: { kind: 'asset' | 'vulnerability'; recordId: number }) {
  const { data } = useQuery<Tag[]>({
    queryKey: ['audit-finding-tags', kind, recordId],
    queryFn: () => auditRegisterApi.findingsFor(kind, recordId).then((r) => r.data),
    enabled: Number.isFinite(recordId),
    retry: false,
  });
  if (!data?.length) return null;
  return (
    <section style={{ background: '#fff', border: '1px solid #E8ECEE', borderRadius: 15, boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #F0F3F5' }}>
        <h4 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Audit findings</h4>
      </div>
      <div style={{ padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((t) => (
          <Link key={t.issue_id} href={`/issues/${t.issue_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <span style={{ display: 'inline-flex', borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: 600, background: '#FDF1E7', color: '#9A4A10' }}>
              Audit finding: {t.reference || `#${t.issue_id}`}
            </span>
            <div style={{ fontSize: 11.5, color: '#3A4653', marginTop: 3 }}>{t.title}</div>
            <div style={{ fontSize: 10.5, color: '#8A95A1' }}>
              {[t.report, (t.workflow_state || '').replace(/_/g, ' ')].filter(Boolean).join(' · ')}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
