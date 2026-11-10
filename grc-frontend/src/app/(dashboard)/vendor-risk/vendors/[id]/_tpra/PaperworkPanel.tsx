'use client';

// Paperwork tab of a vendor: its documents (what each covers, how long it holds, who
// checked it) and its SOC reports read into fields, the verdict first.

import { useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { usePeople } from '../../../_lib/portfolioApi';
import { ErrorState, useConfirm } from '@/components/ui/ds';
import { clsx } from 'clsx';
import { Archive, Check, FileText, Loader2, Network, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { evidenceApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';
import { errText } from '../../../_lib/intake/types';
import {
  paperworkApi, type Cuec, type CuecStatus, type Opinion, type PaperDoc, type SocReview, type Subservice,
} from '../../../_lib/paperworkApi';
import { BTN } from '../_record/btn';
import RecordPanel from '../_record/RecordPanel';
import { Skeleton } from '@/components/ui/ds';
import { fmt } from '../../../_ui/fmt';
import RenewalDialog from '../_record/RenewalDialog';

type Tone = 'red' | 'amber' | 'green' | 'grey';
const TONE: Record<Tone, string> = {
  red: 'border-ds-danger-border bg-ds-danger-soft text-ds-danger',
  amber: 'border-ds-border-strong bg-ds-warning-soft text-ds-warning',
  green: 'border-ds-border-strong bg-ds-success-soft text-ds-success',
  grey: 'border-ds-border bg-ds-surface-subtle text-ds-fg-body',
};
const KIND_LABEL = { soc1: 'SOC 1', soc2: 'SOC 2', soc3: 'SOC 3' } as const;
const TYPE_LABEL = { type1: 'Type 1', type2: 'Type 2' } as const;
const OPINION_LABEL: Record<Opinion, string> = {
  unqualified: 'Unqualified', qualified: 'Qualified', adverse: 'Adverse', disclaimer: 'Disclaimer of opinion',
};
const CRITERIA: Array<[string, string]> = [
  ['security', 'Security'], ['availability', 'Availability'], ['processing_integrity', 'Processing integrity'],
  ['confidentiality', 'Confidentiality'], ['privacy', 'Privacy'],
];
const CUEC_STATUS: Record<CuecStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'amber' }, in_place: { label: 'In place', tone: 'green' },
  not_applicable: { label: 'Not needed', tone: 'grey' },
};
const SEVERITY_TONE: Record<string, Tone> = { critical: 'red', high: 'red', medium: 'amber', low: 'grey' };
const FILE_ACCEPT = '.pdf,.docx,.txt,.rtf,.png,.jpg,.jpeg,.tif,.tiff';

const btn = 'inline-flex items-center gap-1 rounded-ds-control border px-2 py-1 text-[12px] font-medium disabled:opacity-60';
const input = 'w-full rounded-ds-card border border-ds-border-strong bg-ds-surface px-2.5 py-1.5 text-[13px] text-ds-fg focus-visible:border-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-strong';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDate = (d?: string | null) => (d ? fmt.date(d) : '—');      // "5 Mar 2026", as everywhere in the module (a server time is read as UTC)
const stamped = (iso: string | null) => fmtDate(iso);

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium', TONE[tone])}>{children}</span>;
}

function Loading() {
  return <p className="flex items-center gap-2 py-3 text-[12px] text-ds-fg-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>;
}

function refreshPaperwork(qc: QueryClient, vendorId: number) {
  qc.invalidateQueries({ queryKey: ['tprm-soc-reviews', vendorId] });
  qc.invalidateQueries({ queryKey: ['tprm-paperwork', vendorId] });
  // a review can raise a finding, open an assessment, suspend the vendor or add a fourth party
  qc.invalidateQueries({ predicate: (q) => ['tpra-findings', 'tpra-lifecycle', 'tpra-impact', 'vendor'].includes(String(q.queryKey[0])) });
}

export type PaperworkSection = 'documents' | 'soc';

/** `sections` picks which parts to show: the Paperwork tab places the documents and the assurance reports apart, in its own order. */
export default function PaperworkPanel({ vendorId, sections = ['documents', 'soc'] }: { vendorId: number; sections?: PaperworkSection[] }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');
  const canLink = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  return (
    <div className="space-y-[20px]">
      {sections.includes('documents') && <Documents vendorId={vendorId} canEdit={canEdit} canRequest={canLink} />}
      {sections.includes('soc') && <SocReports vendorId={vendorId} canEdit={canEdit} canLink={canLink} />}
    </div>
  );
}

// ── documents ────────────────────────────────────────────────────────────────

function Documents({ vendorId, canEdit, canRequest }: { vendorId: number; canEdit: boolean; canRequest: boolean }) {
  const [renewing, setRenewing] = useState<PaperDoc | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tprm-paperwork', vendorId],
    queryFn: async () => (await paperworkApi.documents(vendorId)).data,
  });
  const need = [data?.counts.expired ? `${data.counts.expired} expired` : null, data?.counts.expiring ? `${data.counts.expiring} expiring` : null].filter(Boolean).join(' · ');
  return (
    <RecordPanel
      title="Documents"
      description={need || undefined}
      info={`What the vendor gave us and the evidence linked to its assessments, each once. One holds until the earlier of its expiry and the end of the period it covers, and is expiring ${data?.expiring_days ?? 60} days before.`}
    >
      {isLoading ? <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div> : isError ? (
        <ErrorState compact title="Couldn’t load the documents" onRetry={() => { void refetch(); }} />
      ) : !data?.items.length ? (
        <p className="text-[13px] leading-5 text-ds-fg-muted">No documents yet. Files the vendor uploads, and evidence linked to its assessments, show here.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.items.map((d) => <DocRow key={d.link_id} d={d} vendorId={vendorId} canEdit={canEdit} onRenew={canRequest ? () => setRenewing(d) : undefined} />)}
        </ul>
      )}
      <RenewalDialog vendorId={vendorId} doc={renewing} onClose={() => setRenewing(null)} />
    </RecordPanel>
  );
}

function coverage(d: PaperDoc): string {
  if (d.coverage_from && d.coverage_to) return `Covers ${fmtDate(d.coverage_from)} to ${fmtDate(d.coverage_to)}`;
  if (d.coverage_to) return `Covers to ${fmtDate(d.coverage_to)}`;
  if (d.coverage_from) return `Covers from ${fmtDate(d.coverage_from)}`;
  return 'Coverage not set';
}

function Countdown({ d }: { d: PaperDoc }) {
  if (d.days_left === null) return <Chip tone="grey">No end date</Chip>;
  if (d.state === 'expired') return <Chip tone="red">Expired {plural(-d.days_left, 'day')} ago</Chip>;
  if (d.days_left === 0) return <Chip tone="amber">Ends today</Chip>;
  return <Chip tone={d.state === 'expiring' ? 'amber' : 'green'}>{plural(d.days_left, 'day')} left</Chip>;
}

function DocRow({ d, vendorId, canEdit, onRenew }: { d: PaperDoc; vendorId: number; canEdit: boolean; onRenew?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [dates, setDates] = useState({ from: '', to: '' });
  const save = useMutation({
    mutationFn: async (body: { coverage_from?: string | null; coverage_to?: string | null }) =>
      (await paperworkApi.reviewDocument(vendorId, d.link_id, body)).data,
    onSuccess: (fresh) => { qc.setQueryData(['tprm-paperwork', vendorId], fresh); setEditing(false); toast({ type: 'success', title: 'Saved' }); },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });
  const kind = d.kind ? d.kind.split(':')[0] : d.evidence_type ? d.evidence_type.replace(/_/g, ' ') : null;
  return (
    <li className="rounded-ds-card border border-ds-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-ds-fg-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-fg">{d.name}</span>
        {kind && <span className="rounded-full bg-ds-surface-hover px-2 py-0.5 text-[12px] capitalize text-ds-fg-body">{kind}</span>}
        {d.from_supplier && <span className="rounded-full bg-ds-primary-soft px-2 py-0.5 text-[12px] text-ds-primary-text">From vendor</span>}
        <Countdown d={d} />
        <EvidencePreviewButton evidenceId={d.evidence_id} label="View" />
      </div>
      <p className="mt-1 text-[12px] text-ds-fg-muted">
        {coverage(d)}{d.expiry_date && ` · expiry ${fmtDate(d.expiry_date)}`}
        {' · '}{d.reviewed_at ? `Reviewed by ${d.reviewed_by_name || 'a colleague'}, ${stamped(d.reviewed_at)}` : 'Not reviewed'}
      </p>
      {(canEdit || (onRenew && (d.state === 'expired' || d.state === 'expiring'))) && !editing && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {onRenew && (d.state === 'expired' || d.state === 'expiring') && (
            <button type="button" className={`${btn} border-ds-border-strong text-ds-primary-text`} onClick={onRenew}>Request renewal</button>
          )}
          {canEdit && (
            <>
              <button type="button" className={`${btn} border-ds-border text-ds-fg-body`}
                onClick={() => { setDates({ from: d.coverage_from || '', to: d.coverage_to || '' }); setEditing(true); }}>
                Set coverage
              </button>
              {!d.reviewed_at && (
                <button type="button" className={`${btn} border-ds-border-strong text-ds-primary-text`} disabled={save.isPending} onClick={() => save.mutate({})}>
                  <Check className="h-3 w-3" aria-hidden /> Mark reviewed
                </button>
              )}
            </>
          )}
        </div>
      )}
      {editing && (
        <form className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); save.mutate({ coverage_from: dates.from || null, coverage_to: dates.to || null }); }}>
          <label className="text-[12px] text-ds-fg-body">From
            <input type="date" className={clsx(input, 'mt-0.5 w-40')} value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />
          </label>
          <label className="text-[12px] text-ds-fg-body">To
            <input type="date" className={clsx(input, 'mt-0.5 w-40')} value={dates.to} min={dates.from || undefined}
              onChange={(e) => setDates({ ...dates, to: e.target.value })} />
          </label>
          <button type="submit" disabled={save.isPending} className={`${btn} border-ds-primary bg-ds-primary text-ds-on-primary`}>
            {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Save
          </button>
          <button type="button" className={`${btn} border-ds-border text-ds-fg-body`} onClick={() => setEditing(false)}>Cancel</button>
          <InfoTip text="The period the document vouches for, such as a certificate's validity or a policy's term. Saving marks it reviewed by you." />
        </form>
      )}
    </li>
  );
}

// ── SOC reports ──────────────────────────────────────────────────────────────

function SocReports({ vendorId, canEdit, canLink }: { vendorId: number; canEdit: boolean; canLink: boolean }) {
  const [open, setOpen] = useState<SocReview | 'new' | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tprm-soc-reviews', vendorId],
    queryFn: async () => (await paperworkApi.socReviews(vendorId)).data,
  });
  const items = data?.items ?? [];
  return (
    <RecordPanel
      title="Assurance reports"
      count={items.length || undefined}
      info="An auditor's report on the vendor's controls, read into fields: the opinion and what the auditor found, the period, the controls it expects us to run and the companies it leaves out. An opinion other than unqualified, material findings or exceptions raise a finding."
      action={canEdit ? (
        <button type="button" onClick={() => setOpen('new')} className={BTN}>
          <Plus className="h-4 w-4" aria-hidden /> Record review
        </button>
      ) : undefined}
    >
      {isLoading ? <Skeleton className="h-20 w-full" /> : isError ? (
        <ErrorState compact title="Couldn’t load the assurance reports" onRetry={() => { void refetch(); }} />
      ) : items.length === 0 ? (
        <p className="text-[13px] leading-5 text-ds-fg-muted">No SOC report reviewed yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <SocCard key={r.id} r={r} vendorId={vendorId} canEdit={canEdit} canLink={canLink} onEdit={() => setOpen(r)} />
          ))}
        </ul>
      )}
      {open !== null && <SocForm vendorId={vendorId} review={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </RecordPanel>
  );
}

function SocCard({ r, vendorId, canEdit, canLink, onEdit }: {
  r: SocReview; vendorId: number; canEdit: boolean; canLink: boolean; onEdit: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const fail = (e: unknown) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') });
  const archive = useMutation({
    mutationFn: () => paperworkApi.archiveSocReview(vendorId, r.id),
    onSuccess: () => { refreshPaperwork(qc, vendorId); toast({ type: 'success', title: 'Review archived' }); }, onError: fail,
  });
  const link = useMutation({
    mutationFn: (name: string) => paperworkApi.addFourthParty(vendorId, r.id, name),
    onSuccess: () => { refreshPaperwork(qc, vendorId); toast({ type: 'success', title: 'Added as a fourth party' }); }, onError: fail,
  });
  const period = r.period_start && r.period_end ? `covers ${fmtDate(r.period_start)} to ${fmtDate(r.period_end)}`
    : r.period_end ? `period to ${fmtDate(r.period_end)}` : 'period not recorded';
  const openCuecs = r.cuecs.filter((c) => c.status === 'open').length;
  return (
    <li className="rounded-ds-card border border-ds-border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={r.verdict_tone}>{r.verdict}</Chip>
        {r.stale && <Chip tone="amber">Too old to rely on alone</Chip>}
        {r.needs_bridge_letter && <Chip tone="amber">Bridge letter needed</Chip>}
        {r.bridge_letter === 'received' && !r.needs_bridge_letter && (
          <Chip tone="green">Bridge letter{r.bridge_letter_until ? ` to ${fmtDate(r.bridge_letter_until)}` : ''}</Chip>
        )}
      </div>
      <p className="mt-1 text-[12px] text-ds-fg-body">
        {KIND_LABEL[r.report_kind]} {TYPE_LABEL[r.report_type]}{r.auditor_firm ? ` · ${r.auditor_firm}` : ''} · {period}
        {r.issued_on ? ` · issued ${fmtDate(r.issued_on)}` : ''}
      </p>
      {r.exceptions_summary && <p className="mt-1 whitespace-pre-line text-[12px] text-ds-fg-body">{r.exceptions_summary}</p>}

      {r.report_kind !== 'soc1' && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Criteria">
          {CRITERIA.map(([key, label]) => (r.tsc.includes(key) ? (
            <span key={key} className="inline-flex items-center gap-0.5 rounded-full bg-ds-primary-soft px-2 py-0.5 text-[12px] font-medium text-ds-primary-text">
              <Check className="h-3 w-3" aria-hidden /> {label}
            </span>
          ) : (
            <span key={key} className="rounded-full bg-ds-surface-hover px-2 py-0.5 text-[12px] text-ds-fg-muted">{label}: not covered</span>
          )))}
        </div>
      )}

      {r.findings.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {r.findings.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <Chip tone={SEVERITY_TONE[f.severity] || 'grey'}><span className="capitalize">{f.severity}</span></Chip>
              <Link href={`/vendor-risk/vendors/${vendorId}?stage=findings&finding=${f.id}`} className="text-ds-primary-text hover:underline">{f.title}</Link>
              <span className="text-ds-fg-muted">{f.status.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      )}

      {r.cuecs.length > 0 && (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[12px] font-[600] text-ds-fg-body">
            Controls we run{openCuecs ? ` · ${openCuecs} open` : ''}
            <InfoTip text="The report's complementary user entity controls: what the vendor relies on us to do. Its opinion only covers us if we do them." />
          </p>
          <ul className="mt-1 space-y-0.5">
            {r.cuecs.map((c, i) => (
              <li key={c.id || i} className="flex flex-wrap items-center gap-1.5 text-[12px] text-ds-fg-body">
                <Chip tone={CUEC_STATUS[c.status].tone}>{CUEC_STATUS[c.status].label}</Chip>
                <span className="min-w-0 flex-1">{c.text}{c.note ? <span className="text-ds-fg-muted"> · {c.note}</span> : null}</span>
                <span className="text-ds-fg-muted">{c.owner_name || 'No owner'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.subservice_orgs.length > 0 && (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[12px] font-[600] text-ds-fg-body">
            Subservice organisations
            <InfoTip text="Companies the vendor relies on to run the service. A carved-out one is outside this report, so its controls need assurance of their own." />
          </p>
          <ul className="mt-1 space-y-0.5">
            {r.subservice_orgs.map((o, i) => (
              <li key={`${i}-${o.name}`} className="flex flex-wrap items-center gap-1.5 text-[12px] text-ds-fg-body">
                <span className="font-medium">{o.name}</span>
                <span className="text-ds-fg-muted">{o.method === 'carve_out' ? 'Carved out' : 'Included'}</span>
                {o.fourth_party_id ? (
                  <span className="inline-flex items-center gap-0.5 text-[12px] text-ds-primary-text"><Check className="h-3 w-3" aria-hidden /> Fourth party</span>
                ) : o.method === 'carve_out' && canLink ? (
                  <button type="button" className={`${btn} border-ds-border-strong text-ds-primary-text`} disabled={link.isPending} onClick={() => link.mutate(o.name)}>
                    <Network className="h-3 w-3" aria-hidden /> Add as fourth party
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ds-border pt-2 text-[12px] text-ds-fg-muted">
        {r.evidence ? (
          <span className="flex min-w-0 items-center gap-1">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{r.evidence.file_name || r.evidence.name}</span>
            <EvidencePreviewButton evidenceId={r.evidence.id} label="View" />
          </span>
        ) : <span>No report attached</span>}
        <span className="flex-1" />
        {r.reviewed_at && <span>Reviewed by {r.reviewer_name || 'a colleague'}, {stamped(r.reviewed_at)}</span>}
        {canEdit && (
          <>
            <button type="button" className={`${btn} border-ds-border text-ds-fg-body`} onClick={onEdit}><Pencil className="h-3 w-3" aria-hidden /> Edit</button>
            <button type="button" className={`${btn} border-ds-border text-ds-fg-body`} disabled={archive.isPending}
              onClick={async () => { if (await confirm({ title: 'Archive this review?', message: 'Any finding it raised stays as it is.', confirmLabel: 'Archive', tone: 'danger' })) archive.mutate(); }}>
              <Archive className="h-3 w-3" aria-hidden /> Archive
            </button>
          </>
        )}
      </div>
      {confirmDialog}
    </li>
  );
}

// ── recording a review ───────────────────────────────────────────────────────

type Form = {
  report_kind: SocReview['report_kind']; report_type: SocReview['report_type']; period_start: string; period_end: string;
  issued_on: string; auditor_firm: string; opinion: Opinion; tsc: string[]; exceptions_count: string;
  exceptions_summary: string; material_findings: boolean; bridge_letter: '' | 'received' | 'needed' | 'not_needed';
  bridge_letter_until: string; cuecs: Cuec[]; subservice_orgs: Subservice[]; notes: string; evidence_id: number | null;
};

function toForm(r: SocReview | null): Form {
  return {
    report_kind: r?.report_kind ?? 'soc2', report_type: r?.report_type ?? 'type2', period_start: r?.period_start ?? '',
    period_end: r?.period_end ?? '', issued_on: r?.issued_on ?? '', auditor_firm: r?.auditor_firm ?? '',
    opinion: r?.opinion ?? 'unqualified', tsc: r?.tsc ?? ['security'], exceptions_count: String(r?.exceptions_count ?? 0),
    exceptions_summary: r?.exceptions_summary ?? '', material_findings: r?.material_findings ?? false,
    bridge_letter: r?.bridge_letter ?? '', bridge_letter_until: r?.bridge_letter_until ?? '',
    cuecs: (r?.cuecs ?? []).map(({ id, text, owner_id, status, note }) => ({ id, text, owner_id, status, note })),
    subservice_orgs: r?.subservice_orgs ?? [], notes: r?.notes ?? '', evidence_id: r?.evidence_id ?? null,
  };
}

function toBody(f: Form): Record<string, unknown> {
  const t = (v: string) => (v.trim() ? v.trim() : null);
  return {
    report_kind: f.report_kind, report_type: f.report_type, period_start: t(f.period_start), period_end: t(f.period_end),
    issued_on: t(f.issued_on), auditor_firm: t(f.auditor_firm), opinion: f.opinion,
    tsc: f.report_kind === 'soc1' ? [] : f.tsc, exceptions_count: Number(f.exceptions_count) || 0,
    exceptions_summary: t(f.exceptions_summary), material_findings: f.material_findings,
    bridge_letter: f.bridge_letter || null, bridge_letter_until: f.bridge_letter === 'received' ? t(f.bridge_letter_until) : null,
    cuecs: f.cuecs.filter((c) => c.text.trim()), subservice_orgs: f.subservice_orgs.filter((o) => o.name.trim()),
    notes: t(f.notes), evidence_id: f.evidence_id,
  };
}

function Field({ id, label, tip, children, className }: {
  id: string; label: string; tip?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1">
        <label htmlFor={id} className="text-[12px] font-medium text-ds-fg-body">{label}</label>
        {tip && <InfoTip label={`About ${label.toLowerCase()}`} text={tip} />}
      </div>
      {children}
    </div>
  );
}

function Block({ title, tip, children }: { title: string; tip?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <h3 className="mb-3 flex items-center gap-1 text-[12px] font-[600] uppercase tracking-wide text-ds-fg-muted">
        {title}{tip && <InfoTip label={`About ${title.toLowerCase()}`} text={tip} />}
      </h3>
      {children}
    </section>
  );
}

function LibraryPicker({ onPick }: { onPick: (e: { id: number; name: string }) => void }) {
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['evidence-library'],
    queryFn: async () => ((await evidenceApi.getAll()).data ?? []) as unknown as Array<{ id: number; name: string; file_name?: string | null }>,
  });
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data ?? []).filter((e) => !t || e.name?.toLowerCase().includes(t) || e.file_name?.toLowerCase().includes(t)).slice(0, 20);
  }, [data, q]);
  return (
    <div className="mt-2 rounded-ds-card border border-ds-border bg-ds-surface-subtle p-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the evidence library" aria-label="Search the evidence library"
        className={input} autoFocus />
      {isLoading ? <Loading /> : (
        <ul className="mt-1 max-h-44 overflow-y-auto">
          {shown.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onPick({ id: e.id, name: e.name })}
                className="flex w-full items-center gap-2 rounded-ds-control px-2 py-1.5 text-left text-[12px] text-ds-fg-body hover:bg-ds-surface">
                <FileText className="h-3.5 w-3.5 shrink-0 text-ds-fg-muted" aria-hidden />
                <span className="truncate">{e.name}{e.file_name ? ` · ${e.file_name}` : ''}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1.5 text-[12px] text-ds-fg-muted">Nothing matches.</li>}
        </ul>
      )}
    </div>
  );
}

function SocForm({ vendorId, review, onClose }: { vendorId: number; review: SocReview | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const fid = (key: string) => `${uid}-${key}`;
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form>(() => toForm(review));
  const [file, setFile] = useState<File | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string | null>(review?.evidence ? review.evidence.file_name || review.evidence.name : null);
  const [savedId, setSavedId] = useState<number | null>(review?.id ?? null);   // a retry after a failed upload updates
  const users = usePeople();

  const save = useMutation({
    mutationFn: async () => {
      const body = toBody(form);
      let id = savedId;
      if (id) await paperworkApi.updateSocReview(vendorId, id, body);
      else {
        id = (await paperworkApi.createSocReview(vendorId, body)).data.id;
        setSavedId(id);
      }
      if (file) await paperworkApi.uploadSocReport(vendorId, id, file);
    },
    onSuccess: () => { toast({ type: 'success', title: review ? 'Review saved' : 'Review recorded' }); onClose(); },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
    onSettled: () => refreshPaperwork(qc, vendorId),
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setCuec = (i: number, patch: Partial<Cuec>) => set('cuecs', form.cuecs.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const setOrg = (i: number, patch: Partial<Subservice>) =>
    set('subservice_orgs', form.subservice_orgs.map((o, n) => (n === i ? { ...o, ...patch } : o)));
  const badPeriod = !!form.period_start && !!form.period_end && form.period_end < form.period_start;

  return (
    <RightSlidePanel isOpen onClose={onClose} title={review ? 'SOC report review' : 'Record a SOC report review'} width="w-full max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-ds-card border border-ds-border px-[16px] py-2 text-[13px] text-ds-fg-body hover:bg-ds-surface-subtle">Cancel</button>
          <button type="submit" form="soc-review-form" disabled={save.isPending || badPeriod}
            className="inline-flex items-center gap-1.5 rounded-ds-card bg-ds-primary px-[16px] py-2 text-[13px] font-medium text-ds-on-primary hover:bg-ds-primary-hover disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      }>
      <form id="soc-review-form" className="space-y-[16px]" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Block title="Report">
          <div className="grid gap-[12px] sm:grid-cols-3">
            <Field id={fid('kind')} label="Kind">
              <select id={fid('kind')} className={input} value={form.report_kind} onChange={(e) => set('report_kind', e.target.value as Form['report_kind'])}>
                {Object.entries(KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </Field>
            <Field id={fid('type')} label="Type" tip="Type 1 checks that controls are designed well on one day; Type 2 tests that they worked over a period.">
              <select id={fid('type')} className={input} value={form.report_type} onChange={(e) => set('report_type', e.target.value as Form['report_type'])}>
                {Object.entries(TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </Field>
            <Field id={fid('auditor')} label="Auditor">
              <input id={fid('auditor')} className={input} value={form.auditor_firm} maxLength={200} onChange={(e) => set('auditor_firm', e.target.value)} />
            </Field>
            <Field id={fid('from')} label="Period from">
              <input id={fid('from')} type="date" className={input} value={form.period_start} onChange={(e) => set('period_start', e.target.value)} />
            </Field>
            <Field id={fid('to')} label="Period to">
              <input id={fid('to')} type="date" className={input} value={form.period_end} onChange={(e) => set('period_end', e.target.value)} />
            </Field>
            <Field id={fid('issued')} label="Issued">
              <input id={fid('issued')} type="date" className={input} value={form.issued_on} onChange={(e) => set('issued_on', e.target.value)} />
            </Field>
          </div>
          {badPeriod && <p role="alert" className="mt-2 text-[12px] text-ds-danger">The period ends before it starts.</p>}
        </Block>

        <Block title="Opinion">
          <div className="grid gap-[12px] sm:grid-cols-3">
            <Field id={fid('opinion')} label="Opinion" tip="Anything but unqualified means the auditor could not say the controls worked; it raises a critical finding.">
              <select id={fid('opinion')} className={input} value={form.opinion} onChange={(e) => set('opinion', e.target.value as Opinion)}>
                {Object.entries(OPINION_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </Field>
            <Field id={fid('exceptions')} label="Exceptions" tip="Tests where a control did not work as described. Any raise a medium finding.">
              <input id={fid('exceptions')} type="number" min={0} className={input} value={form.exceptions_count}
                onChange={(e) => set('exceptions_count', e.target.value)} />
            </Field>
            <div className="flex items-center gap-1 self-end pb-2">
              <label className="flex items-center gap-2 text-[12px] font-medium text-ds-fg-body">
                <input type="checkbox" checked={form.material_findings} onChange={(e) => set('material_findings', e.target.checked)} />
                Material findings
              </label>
              <InfoTip label="About material findings" text="Findings serious enough to matter even under an unqualified opinion. They raise a high finding." />
            </div>
          </div>
          <Field id={fid('found')} label="What the auditor found" className="mt-3">
            <textarea id={fid('found')} rows={2} className={input} value={form.exceptions_summary} onChange={(e) => set('exceptions_summary', e.target.value)} />
          </Field>
        </Block>

        {form.report_kind !== 'soc1' && (
          <Block title="Criteria" tip="The trust services criteria the report covers. One left out is not vouched for.">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Criteria covered">
              {CRITERIA.map(([key, label]) => {
                const on = form.tsc.includes(key);
                return (
                  <label key={key} className={clsx('relative flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]',
                    'focus-within:ring-2 focus-within:ring-ds-border-strong',
                    on ? 'border-ds-border-strong bg-ds-primary-soft text-ds-primary-text' : 'border-ds-border text-ds-fg-body')}>
                    <input type="checkbox" className="sr-only" checked={on}
                      onChange={() => set('tsc', on ? form.tsc.filter((k) => k !== key) : [...form.tsc, key])} />
                    {on && <Check className="h-3 w-3" aria-hidden />} {label}
                  </label>
                );
              })}
            </div>
          </Block>
        )}

        <Block title="Bridge letter" tip="A letter from the vendor vouching that nothing material changed between the end of the period and a later date.">
          <div className="grid gap-[12px] sm:grid-cols-2">
            <Field id={fid('bridge')} label="Letter">
              <select id={fid('bridge')} className={input} value={form.bridge_letter} onChange={(e) => set('bridge_letter', e.target.value as Form['bridge_letter'])}>
                <option value="">Not recorded</option><option value="received">Received</option>
                <option value="needed">Needed</option><option value="not_needed">Not needed</option>
              </select>
            </Field>
            {form.bridge_letter === 'received' && (
              <Field id={fid('bridge-to')} label="Covers to">
                <input id={fid('bridge-to')} type="date" className={input} value={form.bridge_letter_until}
                  onChange={(e) => set('bridge_letter_until', e.target.value)} />
              </Field>
            )}
          </div>
        </Block>

        <Block title="Controls we run" tip="The report's complementary user entity controls: what the vendor relies on us to do. Give each an owner.">
          <div className="space-y-2">
            {form.cuecs.map((c, i) => (
              <div key={c.id || `new-${i}`} className="grid gap-2 rounded-ds-card border border-ds-border p-2 sm:grid-cols-[1fr_9rem_8rem_auto]">
                <input aria-label="Control" className={input} value={c.text} maxLength={1000} placeholder="e.g. Review user access each quarter"
                  onChange={(e) => setCuec(i, { text: e.target.value })} />
                <select aria-label="Owner" className={input} value={c.owner_id ?? ''}
                  onChange={(e) => setCuec(i, { owner_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">No owner</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select aria-label="Status" className={input} value={c.status} onChange={(e) => setCuec(i, { status: e.target.value as CuecStatus })}>
                  {(Object.keys(CUEC_STATUS) as CuecStatus[]).map((s) => <option key={s} value={s}>{CUEC_STATUS[s].label}</option>)}
                </select>
                <button type="button" aria-label="Remove control" onClick={() => set('cuecs', form.cuecs.filter((_, n) => n !== i))}
                  className="self-center rounded p-1 text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-danger">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <input aria-label="Note" className={clsx(input, 'sm:col-span-4')} value={c.note ?? ''} maxLength={1000} placeholder="Note"
                  onChange={(e) => setCuec(i, { note: e.target.value || null })} />
              </div>
            ))}
            <button type="button" className={`${btn} border-ds-border text-ds-fg-body`}
              onClick={() => set('cuecs', [...form.cuecs, { text: '', owner_id: null, status: 'open', note: null }])}>
              <Plus className="h-3 w-3" aria-hidden /> Add control
            </button>
          </div>
        </Block>

        <Block title="Subservice organisations" tip="Companies the vendor relies on. Carved out means the report does not cover them; included means it does.">
          <div className="space-y-2">
            {form.subservice_orgs.map((o, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input aria-label="Organisation" className={clsx(input, 'min-w-[12rem] flex-1')} value={o.name} maxLength={255}
                  onChange={(e) => setOrg(i, { name: e.target.value })} placeholder="e.g. Amazon Web Services" />
                <select aria-label="How the report treats it" className={clsx(input, 'w-36')} value={o.method}
                  onChange={(e) => setOrg(i, { method: e.target.value as Subservice['method'] })}>
                  <option value="carve_out">Carved out</option><option value="inclusive">Included</option>
                </select>
                <button type="button" aria-label="Remove organisation" onClick={() => set('subservice_orgs', form.subservice_orgs.filter((_, n) => n !== i))}
                  className="rounded p-1 text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-danger">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button type="button" className={`${btn} border-ds-border text-ds-fg-body`}
              onClick={() => set('subservice_orgs', [...form.subservice_orgs, { name: '', method: 'carve_out', fourth_party_id: null }])}>
              <Plus className="h-3 w-3" aria-hidden /> Add organisation
            </button>
          </div>
        </Block>

        <Block title="Report file">
          <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" aria-label="SOC report file"
            onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f) { setFile(f); setPicked(null); set('evidence_id', null); } e.target.value = ''; }} />
          <p className="text-[12px] text-ds-fg-body">
            {file ? `To upload: ${file.name}` : picked ? `Kept in the library: ${picked}` : 'No file yet'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={`${btn} border-ds-border text-ds-fg-body`} onClick={() => fileRef.current?.click()}>
              <Upload className="h-3 w-3" aria-hidden /> Upload
            </button>
            <button type="button" className={`${btn} border-ds-border text-ds-fg-body`} onClick={() => setPicking((v) => !v)}>
              <Search className="h-3 w-3" aria-hidden /> From the library
            </button>
          </div>
          {picking && (
            <LibraryPicker onPick={(e) => { set('evidence_id', e.id); setPicked(e.name); setFile(null); setPicking(false); }} />
          )}
        </Block>

        <Block title="Notes">
          <textarea rows={3} className={input} aria-label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Block>
      </form>
    </RightSlidePanel>
  );
}
