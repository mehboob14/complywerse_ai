'use client';

// A finding's Links tab: where it also lives in the platform (the MRA in Statutory Audit, the self-identified event in Incidents, the business unit), the regulator's own status for an MRA (Audit
// Services set it), and, for Audit Services, suggestions of controls and risks it looks related to. A suggestion is only a suggestion: nothing is linked to a bank's audit finding until a person
// accepts it. The full list of links, the actions and the comments are on the issue itself.
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, FileText, Landmark, Link2, Sparkles } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormField, Notice, Select, SkeletonLines, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi, issuesApi } from '@/lib/api';
import { statusLabel } from '@/lib/format';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import { REFRESH_FINDING, useFinding } from './registerData';

type ControlSuggestion = { normalized_control_id: number; code: string | null; name: string | null; domain: string | null; score: number; why: string[] };
type RiskSuggestion = { risk_id: number; title: string; score: number; why: string[]; by: string; reason?: string };
const HEAD = 'm-0 !text-ds-label !font-[600] !text-ds-fg-muted';
const LINK = 'inline-flex min-h-ds-control items-center gap-[6px] rounded-ds-control border border-ds-border-strong px-[10px] text-ds-body font-medium text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

export function LinksPanel({ issueId, rights }: { issueId: number; rights: RegisterRights }) {
  const finding = useFinding(issueId);
  const [suggesting, setSuggesting] = useState(false);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const suggestions = useQuery<{ controls: ControlSuggestion[]; risks: RiskSuggestion[] }>({
    queryKey: ['audit-register-suggestions', issueId], enabled: suggesting, retry: false,
    queryFn: async () => (await auditRegisterApi.suggestions(issueId)).data,
  });
  const regulator = useReportedMutation({
    mutationFn: (status: string) => auditRegisterApi.setRegulatorStatus(issueId, status),
    success: 'Regulator status saved',
    failure: "Couldn't save the regulator status",
    invalidate: REFRESH_FINDING(issueId),
  });
  const link = useReportedMutation({
    mutationFn: async (s: { key: string; kind: 'control' | 'risk'; id: number }) => (s.kind === 'control'
      ? issuesApi.links.controls.add(issueId, { target_type: 'normalized', control_id: s.id, link_type: 'failed', notes: 'Accepted from the audit register suggestions' })
      : issuesApi.links.risks.add(issueId, { risk_id: s.id, link_type: 'instance_of', notes: 'Accepted from the audit register suggestions' })),
    success: 'Linked to the issue',
    failure: "Couldn't link it",
    invalidate: [['issue-links', issueId]],
    onSuccess: (_d, s) => setLinked((prev) => new Set(prev).add(s.key)),
  });

  if (finding.isLoading) return <SkeletonLines lines={4} label="Loading the links" />;
  if (finding.isError || !finding.data) return <ErrorState compact title="Couldn't load the links" message={errorMessage(finding.error)} onRetry={() => { void finding.refetch(); }} />;
  const links = finding.data.links;
  const any = !!links && (links.observation || links.incident || links.business_unit || links.regulator_statuses.length > 0);

  return (
    <div className="flex flex-col gap-[16px]">
      <section aria-label="Also in the platform" className="flex flex-col gap-[8px]">
        <h3 className={HEAD}>Also in the platform</h3>
        {!any && <p className="m-0 text-ds-body text-ds-fg-muted">Nothing else in the platform points at this finding yet.</p>}
        <div className="flex flex-wrap gap-[8px]">
          {links?.observation && <Link href={`/auditor-portal/statutory-audit/${links.observation.id}`} className={LINK}><Landmark aria-hidden className="h-[14px] w-[14px]" /> Statutory Audit · {links.observation.code} · {statusLabel(links.observation.status)}</Link>}
          {links?.incident && <Link href="/erm/incidents" className={LINK}><FileText aria-hidden className="h-[14px] w-[14px]" /> Incident · {links.incident.title} · {statusLabel(links.incident.status)}</Link>}
          {links?.business_unit && <span className="inline-flex min-h-ds-control items-center rounded-ds-control bg-ds-surface-hover px-[10px] text-ds-body text-ds-fg-body">Business unit · {links.business_unit.name}</span>}
        </div>
        {links && links.regulator_statuses.length > 0 && (
          can(rights, 'regulatorStatus') ? (
            <FormField label="Regulator status" hint="What the regulator has said about this finding.">
              <Select value={links.regulator_status || ''} disabled={regulator.isPending} onChange={(e) => regulator.mutate(e.target.value)}>
                <option value="">Not yet submitted to the regulator</option>
                {links.regulator_statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </FormField>
          ) : <p className="m-0 text-ds-body text-ds-fg-body">Regulator status: {links.regulator_status || 'Not yet submitted to the regulator'}</p>
        )}
        <div><Link href={`/issues/${issueId}`} className={LINK}><ArrowUpRight aria-hidden className="h-[14px] w-[14px]" /> Open the full issue: actions, links, comments</Link></div>
      </section>

      {can(rights, 'suggestions') && (
        <section aria-label="Related controls and risks" className="flex flex-col gap-[8px]">
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <h3 className={HEAD}>Related controls and risks</h3>
            <Button leftIcon={<Sparkles aria-hidden />} loading={suggestions.isFetching} onClick={() => (suggesting ? void suggestions.refetch() : setSuggesting(true))}>{suggesting ? 'Suggest again' : 'Suggest controls and risks'}</Button>
          </div>
          {suggesting && suggestions.isError && <ErrorState compact title="Couldn't work out the suggestions" message={errorMessage(suggestions.error)} onRetry={() => { void suggestions.refetch(); }} />}
          {suggesting && suggestions.data && (
            <>
              <Notice tone="info">Suggestions only: accept the ones that hold. Controls are matched on wording; risks are read against your own risk register by AI.</Notice>
              <div className="grid gap-[12px] sm:grid-cols-2">
                <Suggested title="Controls" empty="Nothing close enough to suggest." rows={suggestions.data.controls.map((c) => ({
                  key: `c${c.normalized_control_id}`, id: c.normalized_control_id, kind: 'control' as const,
                  title: [c.code, c.name].filter(Boolean).join(' · '), why: `${c.domain ? `${c.domain} · ` : ''}shares: ${c.why.join(', ') || '—'}`,
                }))} linked={linked} busy={link.isPending} onLink={(s) => link.mutate(s)} />
                <Suggested title="Risks" empty="No risks in the register look related." rows={suggestions.data.risks.map((r) => ({
                  key: `r${r.risk_id}`, id: r.risk_id, kind: 'risk' as const,
                  title: r.title, why: r.by === 'ai' ? (r.reason || 'Read against this finding') : `shares: ${r.why.join(', ') || '—'}`,
                }))} linked={linked} busy={link.isPending} onLink={(s) => link.mutate(s)} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Suggested({ title, empty, rows, linked, busy, onLink }: {
  title: string; empty: string; busy: boolean; linked: Set<string>;
  rows: Array<{ key: string; id: number; kind: 'control' | 'risk'; title: string; why: string }>;
  onLink: (s: { key: string; kind: 'control' | 'risk'; id: number }) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[8px]">
      <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">{title}</p>
      {rows.length === 0 ? <EmptyState bare kind="noMatches" title={empty} /> : rows.map((r) => (
        <div key={r.key} className="flex items-start gap-[8px] rounded-ds-card border border-ds-border p-[8px]">
          <div className="min-w-0 flex-1">
            <p className="m-0 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title}</p>
            <p className="m-0 break-words text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{r.why}</p>
          </div>
          {linked.has(r.key)
            ? <span className="inline-flex shrink-0 items-center gap-[4px] text-ds-label font-[600] text-ds-success"><CheckCircle2 aria-hidden className="h-[14px] w-[14px]" /> Linked</span>
            : <Button size="sm" leftIcon={<Link2 aria-hidden />} disabled={busy} onClick={() => onLink({ key: r.key, kind: r.kind, id: r.id })}>Link</Button>}
        </div>
      ))}
    </div>
  );
}
