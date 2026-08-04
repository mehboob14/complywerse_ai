'use client';

/*
 * AttachmentsPanel — the asset-detail "Attachments" tab (activeTab key 'evidence'),
 * restyled to match the delivered Overview design language VERBATIM.
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the inline `EvidenceTab`
 * in page.tsx: it takes the exact same props, uses the same InlineLinkPicker /
 * GuideMarker primitives, fires the same onLinkEvidence / onUnlinkEvidence
 * handlers, and preserves every capability (link from header, link from empty
 * state, per-item relationship badge, unlink, the six guide markers, loading and
 * empty states). No data fetching, react-query, or mutations live here.
 *
 * Design tokens mirror _overview-design.tsx (same card shell, shadow, hairlines,
 * green accent, uppercase micro-labels). Fonts: Public Sans (UI) + IBM Plex Mono.
 */

import { FileCheck, X } from 'lucide-react';
import { InlineLinkPicker } from '@/components/ui';
import { GuideMarker, useGuide } from '@/components/guide';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Design tokens, lifted verbatim from _overview-design.tsx so the tab reads as
//    one system with the Overview tab. ────────────────────────────────────────
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;

// Relationship pill — keeps the original supports/validates/documents semantics
// but in the Overview's rounded, uppercase, bordered pill form.
const RELATIONSHIP_PILL: Record<string, string> = {
  supports: 'text-[#0f7a5c] bg-[#e7f6ee] border-[#c3ead2]',
  validates: 'text-[#1d5fa8] bg-[#eaf2fc] border-[#c8ddf5]',
  documents: 'text-[#6b3fa0] bg-[#f2ecfb] border-[#ddccf1]',
};

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

  return (
    <div className="font-['Public_Sans',system-ui,sans-serif] text-[#1a2b24] [font-feature-settings:'ss01']">
      <div className={CARD}>
        {/* HEADER — title + count + guide markers, with the link action on the right */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#eceee8]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-extrabold tracking-[-0.01em]">
              <FileCheck className="h-[18px] w-[18px] text-[#0d5c48] shrink-0" />
              Linked Evidence
              <span className="text-[#aab2a8] font-semibold">· {linked.length}</span>
              <GuideMarker id="asset.evidenceWhy" n={1} />
              <GuideMarker id="asset.evidenceModuleLink" n={2} />
            </div>
            <div className="text-[11.5px] text-[#aab2a8] mt-px">
              Documents, scans and attestations attached to this asset
            </div>
          </div>
          <InlineLinkPicker
            triggerLabel="Link Evidence"
            items={evidencePickerItems}
            isLoading={evidenceLoading || isLinking}
            emptyText="No evidence available"
            searchPlaceholder="Search evidence"
            onSelect={(value) => onLinkEvidence(Number(value))}
          />
        </div>

        <div className="px-5 py-[18px]">
          {hasLinked ? (
            <div className="flex flex-col gap-2.5">
              {/* Guide hint line — only when the guide overlay is on */}
              {guideEnabled && (
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[#aab2a8] mb-1">
                  <span>What kinds of documents belong here</span>
                  <GuideMarker id="asset.evidenceTypes" n={3} />
                  <span>· the CIS scan attachment specifically</span>
                  <GuideMarker id="asset.evidenceCisScan" n={4} />
                </div>
              )}

              {linked.map((evidence) => {
                const pill = RELATIONSHIP_PILL[evidence.relationship_type]
                  || 'text-[#5c6b62] bg-[#f0f2ee] border-[#e0e4dc]';
                return (
                  <div
                    key={evidence.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#e6e9e3] bg-[#fafbf8] px-3.5 py-3 transition-[box-shadow,border-color] duration-200 hover:border-[#d7ddd2] hover:shadow-[0_6px_18px_-12px_rgba(18,45,36,0.3)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-[#e8f2ec] text-[#0d5c48] flex items-center justify-center shrink-0">
                        <FileCheck className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-[#1a2b24] truncate">{evidence.name}</p>
                      </div>
                      <span className={'text-[10px] font-bold tracking-[0.04em] uppercase px-2.5 py-[3px] rounded-full border shrink-0 ' + pill}>
                        {evidence.relationship_type}
                      </span>
                    </div>
                    <button
                      onClick={() => onUnlinkEvidence(evidence.id)}
                      disabled={isUnlinking}
                      className="shrink-0 rounded-lg p-1.5 text-[#97a19a] hover:bg-[#fdeceb] hover:text-[#b42318] disabled:opacity-50 transition-colors"
                      title="Unlink Evidence"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            // EMPTY STATE — dashed tile in the Overview palette, with the primary
            // link action preserved.
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#d7ddd2] bg-[#fbfcfa] py-12 text-center">
              <span className="mb-3 w-14 h-14 rounded-2xl bg-[#eef1ec] text-[#97a19a] flex items-center justify-center">
                <FileCheck className="h-7 w-7" />
              </span>
              <h4 className="flex items-center gap-2 text-[15px] font-bold text-[#1a2b24]">
                No Evidence Linked
                <GuideMarker id="asset.evidenceMissing" n={5} />
              </h4>
              <p className="mt-1 flex items-center gap-2 text-[12.5px] text-[#8a948b]">
                Link evidence items to document this asset
                <GuideMarker id="asset.evidenceAuditorUsage" n={6} />
              </p>
              <div className="mt-4">
                <InlineLinkPicker
                  triggerLabel="Link First Evidence"
                  triggerClassName="inline-flex items-center gap-2 rounded-lg bg-[#0d5c48] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0a4a3a] transition-colors disabled:opacity-50"
                  items={evidencePickerItems}
                  isLoading={evidenceLoading || isLinking}
                  emptyText="No evidence available"
                  searchPlaceholder="Search evidence"
                  onSelect={(value) => onLinkEvidence(Number(value))}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
