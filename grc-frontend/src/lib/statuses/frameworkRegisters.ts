// The words of the Registers and Artifacts tabs of a framework journey: a framework document and its sections, a written artifact, how critical an
// asset in an inventory is, and the tone words the register definitions carry. One registry per kind of word, built with defineStatuses
// (lib/status.ts), so a pill always has its word and a word nobody registered is neutral with a readable label. Pure, so
// `node --test src/lib/statuses/frameworkRegisters.test.ts` runs it.
import { defineStatuses, type Tone } from '../status.ts';

// FrameworkDocument.status (backend framework_templates/routers/documents.py: the review workflow sets in_review and approved; the row starts as draft).
export const frameworkDocumentStatus = defineStatuses('framework document', {
  draft: 'neutral',
  in_review: { tone: 'pending', label: 'In review' },
  approved: 'success',
});

// One section of a framework document (documents.py keeps the section as the page sends it: ready | draft | to_start; a section with no word is
// read from its text by documentModel.sectionState).
export const documentSectionState = defineStatuses('framework document section', {
  to_start: { tone: 'neutral', label: 'To start' },
  draft: 'warning',
  ready: 'success',
});

// TenantArtifact.status (the artifacts router stores what the form sends: draft, in_review, approved, archived).
export const artifactStatus = defineStatuses('written artifact', {
  draft: 'neutral',
  in_review: { tone: 'pending', label: 'In review' },
  approved: 'success',
  archived: 'neutral',
});

// ITAsset.criticality, as the CDE and ePHI inventories list it.
export const assetCriticality = defineStatuses('inventory asset criticality', {
  low: 'neutral',
  medium: 'progress',
  high: 'warning',
  critical: 'danger',
});

// The register definitions (backend seed_data/framework_templates/*.json) and the ISO 27001 configs colour a select option with one of these words
// (slate 44, rose 43, emerald 37, amber 23, orange 5 in the shipped definitions; sky and teal in the ISO configs). The word is the data's, the tone is
// the platform's: the label of the option is always drawn beside it.
const LEGACY_TONE: Record<string, Tone> = {
  slate: 'neutral',
  emerald: 'success',
  amber: 'warning',
  orange: 'warning',
  rose: 'danger',
  sky: 'progress',
  teal: 'progress',
};

/** The tone of a select option's colour word; a word the platform does not know reads neutral. */
export function registerTone(word?: string | null): Tone {
  const key = String(word ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEGACY_TONE, key) ? LEGACY_TONE[key] : 'neutral';
}

export const LEGACY_TONE_WORDS: readonly string[] = Object.keys(LEGACY_TONE);
