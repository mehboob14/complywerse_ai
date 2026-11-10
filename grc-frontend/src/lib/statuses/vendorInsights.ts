// The words of Third-Party Vendor Risk > Insights (vendor-insights-setup, 2026-11-10): what a Comply analysis is and how its insurance cover stands, what the AI write-up calls the risk, and where a kept
// report stands. One registry per kind of word, on the platform's tone model (lib/status.ts); a word nobody registered reads neutral with a readable label (defineStatuses). Every word is said in
// words, never a colour alone. Pure (no React), so `node --test` runs vendorInsights.test.ts against it. The risk register's own status words are lib/statuses/risk.ts and a residual score's band is
// lib/statuses/vendor.ts (vendorBand): this file does not repeat them.
import { defineStatuses } from '../status.ts';

/** A Comply analysis (tpra/fair.py `status`). Final analyses are the ones the programme adds up. */
export const analysisState = defineStatuses('comply analysis', {
  draft: { tone: 'pending', label: 'Draft' },
  final: { tone: 'success', label: 'Final' },
});

/** How an analysis's insurance cover stands against its one-in-twenty year (`result.cover`: none recorded, covers it, falls short). */
export const analysisCover = defineStatuses('insurance cover', {
  covers: { tone: 'success', label: 'Cover is enough' },
  short: { tone: 'warning', label: 'Cover falls short' },
  none: { tone: 'neutral', label: 'No cover recorded' },
});

/** The level the AI write-up gives an analysis (`ai_review.risk_level`). */
export const analysisRisk = defineStatuses('analysis risk level', {
  low: { tone: 'success', label: 'Low risk' },
  medium: { tone: 'progress', label: 'Medium risk' },
  high: { tone: 'warning', label: 'High risk' },
  critical: { tone: 'danger', label: 'Critical risk' },
});

/** How far the AI write-up says its figures can be trusted (`ai_review.confidence`). */
export const analysisConfidence = defineStatuses('analysis confidence', {
  low: { tone: 'warning', label: 'Low confidence' },
  medium: { tone: 'neutral', label: 'Medium confidence' },
  high: { tone: 'success', label: 'High confidence' },
});

/** Where a kept report stands: a draft until someone approves it, then approved, and shared while an examiner's link is live. A kept report is frozen whatever its state. */
export const reportState = defineStatuses('kept report', {
  draft: { tone: 'pending', label: 'Draft' },
  approved: { tone: 'success', label: 'Approved' },
  shared: { tone: 'progress', label: 'Shared with an examiner' },
});

/** What a report is (tpra/reports.py KINDS): a kind has no meaning to colour. The labels are the server's. */
export const reportKind = defineStatuses('report kind', {
  committee_pack: { tone: 'neutral', label: 'Committee pack' },
  register: { tone: 'neutral', label: 'Register of functions and obligations' },
  vendor_file: { tone: 'neutral', label: 'Vendor evidence file' },
  ratings_quarter: { tone: 'neutral', label: 'Security ratings of critical suppliers' },
  vendor_summary: { tone: 'neutral', label: 'Supplier summary' },
});

/** The kinds in the order the Generate sheet offers them. */
export const REPORT_KINDS = ['committee_pack', 'register', 'vendor_file', 'ratings_quarter', 'vendor_summary'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** The words of what goes wrong in an analysis (`effect`), as the page says them. */
export const ANALYSIS_EFFECTS = ['confidentiality', 'integrity', 'availability'] as const;
export type AnalysisEffect = (typeof ANALYSIS_EFFECTS)[number];
export const EFFECT_WORDS: Record<AnalysisEffect, string> = {
  confidentiality: 'Data exposed', integrity: 'Data tampered with', availability: 'Service stops',
};
