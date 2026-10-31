'use client';

// One campaign, in a drawer: its status, coverage, domain and due date, the link people sign through (copy, open), and every acknowledgement with its
// drawn signature and its sealed record. The server sends all the acknowledgements at once, signatures included (a campaign of 800 is ten megabytes),
// so they are shown a page at a time: the register holds 25 rows, not 800, and the Pager says how many there are in all. "Close campaign" is asked by the
// page (a question that cannot be undone from here); what a signature seals and how Verify works are SignatureSeal's, untouched.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Users } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { EMPTY } from '@/lib/format';
import { attestationStatus, statusPill } from '@/lib/status';
import { AnimatedModal, RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, Pager, RegisterTable, SkeletonLines, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import SignatureSeal from '@/components/governance/SignatureSeal';
import { dayText, momentText, ownName, pageOf } from './_logic';
import { Coverage } from './_Coverage';
import type { Acknowledgment, Campaign } from './_types';

const PAGE_SIZES = [25, 50, 100];

/** A label over a value. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ds-label text-ds-fg-muted">{label}</dt>
      <dd className="mt-[4px] text-ds-body text-ds-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function CampaignDetailDrawer({ id, copied, closing, onCopy, onAskClose, onClose }: {
  id: number;
  copied: boolean;
  closing: boolean;
  onCopy: (c: Campaign) => void;
  onAskClose: (c: Campaign) => void;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['doc-attest-campaign', id],
    queryFn: async () => (await governanceApi.getDocAttestationCampaign(id)).data as Campaign,
    retry: (n, e) => n < 2 && canRetry(e),
  });
  const campaign = q.data;
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);

  const acks = campaign?.acknowledgments ?? [];
  const shown = pageOf(acks, page, size);
  const own = campaign ? ownName(campaign) : '';
  const docTitle = campaign ? campaign.document_title || `Document #${campaign.document_id}` : '';
  const publicUrl = campaign?.public_url || (campaign ? `/attest/${campaign.public_token}` : '');
  const canClose = campaign?.status === 'active' && !!campaign.can_manage;

  const columns: RegisterColumn<Acknowledgment>[] = [
    { key: 'name', header: 'Name', isRowHeader: true, cell: (a) => <span className="font-[600] text-ds-fg">{a.name}</span> },
    { key: 'email', header: 'Email', priority: 2, card: 'meta', cell: (a) => a.email },
    { key: 'designation', header: 'Designation', priority: 2, card: 'meta', cell: (a) => a.designation || <span className="text-ds-fg-muted">{EMPTY}</span> },
    { key: 'signed', header: 'Signed', card: 'meta', cell: (a) => <span className="tabular-nums">{momentText(a.acknowledged_at)}</span> },
    {
      key: 'signature', header: 'Signature', card: 'meta',
      cell: (a) => (
        <div className="flex flex-col items-start gap-1">
          {a.signature_data_url ? (
            <button
              type="button"
              onClick={() => setPreview({ name: a.name, url: a.signature_data_url! })}
              title="View signature"
              aria-label={`View the signature of ${a.name}`}
              className="inline-flex overflow-hidden rounded-ds-control border border-ds-border bg-ds-surface hover:border-ds-primary focus-visible:outline-none focus-visible:shadow-ds-ring"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.signature_data_url} alt="" loading="lazy" className="h-[36px] w-[96px] object-contain p-[2px]" />
            </button>
          ) : <span className="text-ds-fg-muted">{EMPTY}</span>}
          {a.esign_id && a.esign_fingerprint && <SignatureSeal id={a.esign_id} fingerprint={a.esign_fingerprint} thumb={false} ds />}
        </div>
      ),
    },
  ];

  return (
    <>
      <RightSlidePanel
        isOpen
        onClose={onClose}
        title={<span className="block [overflow-wrap:anywhere]">{own || docTitle || 'Attestation'}</span>}
        subtitle={own ? docTitle : undefined}
        widthClassName="w-[880px] max-w-full"
        footer={(
          <div className="flex flex-wrap items-center justify-between gap-2">
            {campaign && canClose ? <Button variant="dangerOutline" loading={closing} onClick={() => onAskClose(campaign)}>Close campaign</Button> : <span />}
            <Button onClick={onClose}>Done</Button>
          </div>
        )}
      >
        {q.isLoading ? (
          <SkeletonLines lines={7} label="Loading the campaign" />
        ) : !campaign ? (
          <ErrorState title="Couldn't load the campaign" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
        ) : (
          <div className="flex flex-col gap-[16px]">
            <dl className="grid grid-cols-2 gap-x-[16px] gap-y-[12px] rounded-ds-card border border-ds-border p-[12px] sm:grid-cols-4">
              <Fact label="Status"><StatusPill {...statusPill(attestationStatus, campaign.status)} /></Fact>
              <Fact label="Coverage"><Coverage c={campaign} /></Fact>
              <Fact label="Domain">
                {campaign.allowed_email_domain
                  ? <span className="font-mono" title="Only people with this email domain can acknowledge">@{campaign.allowed_email_domain}</span>
                  : <span className="text-ds-fg-muted">{EMPTY}</span>}
              </Fact>
              <Fact label="Due">{campaign.due_date ? dayText(campaign.due_date) : <span className="text-ds-fg-muted">{dayText(null)}</span>}</Fact>
            </dl>

            <section className="rounded-ds-card border border-ds-border p-[12px]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <h3 className="!text-ds-body !font-[600] !text-ds-fg">Link</h3>
                  <InfoTip label="About the link" text="Anyone with this link can review the document and acknowledge it. No app login is required." />
                </div>
                <Button variant="link" size="sm" href={`/governance/documents/${campaign.document_id}`} rightIcon={<ExternalLink aria-hidden />}>Open document</Button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[12px] py-[6px] font-mono text-ds-label text-ds-fg-body">{publicUrl}</code>
                <Button leftIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />} onClick={() => onCopy(campaign)}>{copied ? 'Copied' : 'Copy'}</Button>
                {publicUrl.startsWith('http') && (
                  <Button href={publicUrl} target="_blank" rel="noreferrer" leftIcon={<ExternalLink aria-hidden />}>Open</Button>
                )}
              </div>
              {campaign.message && (
                <>
                  <p className="mt-3 text-ds-label text-ds-fg-muted">Message</p>
                  <p className="mt-1 rounded-ds-control bg-ds-surface-subtle px-[12px] py-[6px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{campaign.message}</p>
                </>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Users aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] text-ds-fg-muted" />
                <h3 className="!text-ds-body !font-[600] !text-ds-fg">Acknowledgments</h3>
                <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-ds-surface-hover px-[6px] text-ds-label tabular-nums text-ds-fg-body">{campaign.acknowledgment_count ?? acks.length}</span>
              </div>
              <RegisterTable<Acknowledgment>
                caption="Acknowledgments"
                columns={columns}
                rows={shown.rows}
                getRowId={(a) => a.id}
                cardTitle={(a) => a.name}
                empty={<div className="px-[16px] py-[32px] text-center text-ds-body text-ds-fg-muted">No acknowledgments yet</div>}
                footer={acks.length > 0 ? (
                  <Pager page={shown.range.page} pageSize={size} total={acks.length} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} pageSizes={PAGE_SIZES} noun="acknowledgments" />
                ) : undefined}
              />
            </section>
          </div>
        )}
      </RightSlidePanel>

      {preview && (
        <AnimatedModal isOpen onClose={() => setPreview(null)} size="md" title={preview.name} subtitle="Signature">
          <div className="px-[20px] py-[20px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={`Signature of ${preview.name}`} className="max-h-[288px] w-full rounded-ds-card border border-ds-border bg-ds-surface object-contain p-[16px]" />
          </div>
        </AnimatedModal>
      )}
    </>
  );
}
