// The words of the Control Catalog and the Control Library that `lib/statuses/controls.ts` does not already hold (that file has the effectiveness of a control and of a test,
// the progress of a work item, a custom control's lifecycle and the state of an evidence file: the Catalog's drawer uses those). Two words are new here:
//  - where a Catalog row comes from (`ControlWorkItem.source_type`: workbench.py `_framework_rows` / `_internal_rows` / `_promoted_rows`), and
//  - the review state of a unified (normalized) control in the Library (`NormalizedControl.review_status`: groups.py `_set_review` writes approved or flagged; no decision is pending).
// A source is a KIND, not a state, so all three are neutral and the label tells them apart (a colour would imply a ranking); a review state has a tone.
// Pure, so `node --test src/lib/statuses/catalog.test.ts` runs against it. A word nobody registered is neutral with a readable label, never a guess.
import { defineStatuses } from '../status.ts';

/** Where a Catalog control comes from. "Normalized" is a unified control promoted from the Library. */
export const controlSource = defineStatuses('control source', {
  framework: { tone: 'neutral', label: 'Framework' },
  internal: { tone: 'neutral', label: 'Internal control' },
  normalized: { tone: 'neutral', label: 'Unified' },
});

/** A unified control's review (Master List Review): approved is correct, flagged needs another look, pending has not been looked at. */
export const unifiedReview = defineStatuses('unified control review', {
  approved: { tone: 'success', label: 'Approved' },
  flagged: { tone: 'warning', label: 'Flagged' },
  pending: { tone: 'pending', label: 'Pending review' },
});

export const CATALOG_REGISTRIES = { controlSource, unifiedReview } as const;
