'use client';

/*
 * AttachmentsPanel — the asset-detail "Attachments" tab (activeTab key 'evidence'),
 * restyled to match the delivered Attachments mock (mint-teal token set) VERBATIM.
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the inline `EvidenceTab`
 * in page.tsx: it takes the exact same props, uses the same InlineLinkPicker /
 * GuideMarker primitives, fires the same onLinkEvidence / onUnlinkEvidence
 * handlers, and preserves every capability (link from header, link from empty
 * state, per-item relationship badge, unlink, the six guide markers, loading and
 * empty states). No data fetching, react-query, or mutations live here.
 *
 * The mock is a file-uploader (drop-zone + name/size/uploaded-by/date columns).
 * The real tab links EXISTING evidence records — it has no upload, no file size,
 * no uploaded-by/date. So the mock's drop-zone is not reproduced as a literal
 * uploader (that would fabricate a capability this tab doesn't have); its role
 * is folded into the real "Link Evidence" action, kept where every sibling
 * "linked X" panel puts it (top-right of the header). Size/uploaded-by/date
 * columns are dropped for the same reason; `relationship_type` (a real field)
 * takes their place, styled as the mock's compact chip.
 *
 * Root is a plain content container — no rail, breadcrumb or tab bar; the page
 * shell owns those. Font is inherited (global body font is already Poppins via
 * next/font, see globals.css) rather than re-declared.
 */

import { FileCheck, X } from 'lucide-react';
import { InlineLinkPicker } from '@/components/ui';
import { GuideMarker, useGuide } from '@/components/guide';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Mint-teal tokens, lifted verbatim from the Attachments mock. ───────────
const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden';
const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 h-[33px] px-3.5 rounded-[10px] border border-[#17B898] bg-[#17B898] ' +
  'text-[#06342B] text-[12px] font-semibold hover:bg-[#12A085] disabled:opacity-50 transition-colors whitespace-nowrap';

// Relationship pill — same supports/validates/documents semantics as before,
// recoloured to the mock's chip spec (6px radius, 10.5px, semantic tones).
const RELATIONSHIP_TONE: Record<string, { fg: string; bg: string }> = {
  supports: { fg: '#1F7A54', bg: '#E7F5EE' }, // --green / --green-bg
  validates: { fg: '#2E63A8', bg: '#E9F1FB' }, // --blue / --blue-bg
  documents: { fg: '#6A54C9', bg: '#EEEBFA' }, // --violet / --violet-bg
};
const TONE_DEFAULT = { fg: '#3A4653', bg: '#F0F3F5' }; // --sec / --border2

interface LinkedEvidence {
  id: number;
  evidence_id: number;
  name: string;
  relationship_type: string;
}

export interface AttachmentsPanelProps {
  /** The asset detail record — only `linked_evidence` is read here. */
  asset: { linked_evidence?: LinkedEvidence[] } & Record<string, any>;
  /** Every evidence item, for the link picker. */
  allEvidence: Array<{ id: number | string; title?: string; name?: string; evidence_type?: string }>;
  evidenceLoading: boolean;
  onLinkEvidence: (evidenceId: number) => void;
  isLinking: boolean;
  onUnlinkEvidence: (linkId: number) => void;
  isUnlinking: boolean;
}

export default function AttachmentsPanel({
  asset,
  allEvidence,
  evidenceLoading,
  onLinkEvidence,
  isLinking,
  onUnlinkEvidence,
  isUnlinking,
}: AttachmentsPanelProps) {
  const { enabled: guideEnabled } = useGuide();

  const linked = asset.linked_evidence || [];
  const linkedEvidenceIds = linked.map((e) => e.evidence_id);
  const evidencePickerItems = allEvidence
    .filter((e) => !linkedEvidenceIds.includes(Number(e.id)))
    .map((e) => ({
      value: String(e.id),
      label: e.title || e.name || `Evidence #${e.id}`,
      subLabel: e.evidence_type,
    }));

  const hasLinked = linked.length > 0;

  const picker = (label: string, className: string) => (
    <InlineLinkPicker
      triggerLabel={label}
      triggerClassName={className}
      items={evidencePickerItems}
      isLoading={evidenceLoading || isLinking}
      emptyText="No evidence available"
      searchPlaceholder="Search evidence"
      onSelect={(value) => onLinkEvidence(Number(value))}
    />
  );

  return (
    <div className="text-[13.5px] text-[#0F1F2B]">
      <div className={CARD}>
        {/* HEADER — icon + title + count, description below, link action on the right */}
        <div className="flex items-center gap-[9px] px-4 py-[13px] border-b border-[#F0F3F5]">
          <FileCheck className="h-[18px] w-[18px] text-[#12A085] shrink-0" />
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <h4 className="text-[12.5px] font-semibold text-[#0F1F2B]">Attachments</h4>
            <span className="text-[#AEB8C2] font-medium text-[12.5px]">· {linked.length}</span>
            <GuideMarker id="asset.evidenceWhy" n={1} />
            <GuideMarker id="asset.evidenceModuleLink" n={2} />
          </div>
          {picker('Link Evidence', BTN_PRIMARY)}
        </div>

        <div className="px-4 pt-3 pb-4">
          <p className="text-[11.5px] text-[#8A95A1]">
            Documents, scans and attestations attached to this asset
          </p>

          {/* Guide hint line — only when the guide overlay is on */}
          {guideEnabled && (
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[#8A95A1] mt-2">
              <span>What kinds of documents belong here</span>
              <GuideMarker id="asset.evidenceTypes" n={3} />
              <span>· the CIS scan attachment specifically</span>
              <GuideMarker id="asset.evidenceCisScan" n={4} />
            </div>
          )}

          {hasLinked ? (
            <div className="mt-3">
              {/* column header, mirrors the mock's arow-h micro-label row */}
              <div className="flex items-center gap-3 pb-[7px] border-b border-[#F0F3F5] text-[9.5px] font-bold uppercase tracking-[0.05em] text-[#8A95A1]">
                <span className="w-8 shrink-0" />
                <span className="flex-1">Name</span>
                <span className="shrink-0">Relationship</span>
                <span className="w-[26px] shrink-0" />
              </div>

              {linked.map((evidence) => {
                const tone = RELATIONSHIP_TONE[evidence.relationship_type] || TONE_DEFAULT;
                return (
                  <div
                    key={evidence.id}
                    className="flex items-center gap-3 py-[9px] border-b border-[#F0F3F5] last:border-b-0"
                  >
                    <span
                      className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0"
                      style={{ background: tone.bg, color: tone.fg }}
                    >
                      <FileCheck className="h-[18px] w-[18px]" />
                    </span>
                    <span className="flex-1 min-w-0 text-[12px] font-semibold text-[#0F1F2B] truncate">
                      {evidence.name}
                    </span>
                    <span
                      className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.04em] px-2 py-[2px] rounded-[6px]"
                      style={{ color: tone.fg, background: tone.bg }}
                    >
                      {evidence.relationship_type}
                    </span>
                    <button
                      onClick={() => onUnlinkEvidence(evidence.id)}
                      disabled={isUnlinking}
                      title="Unlink Evidence"
                      className="w-[26px] h-[26px] shrink-0 flex items-center justify-center rounded-[8px] border border-[#E8ECEE] bg-white text-[#6B7787] hover:border-[#F0C6C6] hover:bg-[#FBEAEA] hover:text-[#B23A3A] disabled:opacity-50 transition-colors"
                    >
                      <X className="h-[14px] w-[14px]" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            // EMPTY STATE — dashed tile in the mock's mint palette, primary link action preserved.
            <div className="mt-3 flex flex-col items-center text-center border-[1.5px] border-dashed border-[#E8ECEE] rounded-[11px] bg-[#FAFBFC] px-5 py-[26px]">
              <span className="w-[46px] h-[46px] rounded-[13px] bg-[#E4F8F2] text-[#12A085] flex items-center justify-center">
                <FileCheck className="h-[22px] w-[22px]" />
              </span>
              <h4 className="flex items-center gap-2 text-[13.5px] font-semibold text-[#0F1F2B] mt-3">
                No Evidence Linked
                <GuideMarker id="asset.evidenceMissing" n={5} />
              </h4>
              <p className="flex items-center gap-2 text-[11.5px] text-[#8A95A1] mt-1 max-w-[320px]">
                Link evidence items to document this asset
                <GuideMarker id="asset.evidenceAuditorUsage" n={6} />
              </p>
              <div className="mt-[14px]">
                {picker('Link First Evidence', BTN_PRIMARY + ' px-4')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
