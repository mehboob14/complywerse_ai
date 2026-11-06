// The Documents list's columns after the title, as the explorer's fit wants them (pure: `node --test "src/app/(dashboard)/governance/documents/_workspace/libraryFit.test.ts"`).
// The title (Document) takes what they leave and keeps at least records/explorerFit.TITLE_MIN of it; when the table has less room than that, Frameworks gives way first, then Owner,
// and Status and Next review stay (the list is cards before it loses them). Widths are px with the kit cell's 12px padding on each side. Owner is an avatar (its name is its label)
// until there is room for the name beside it.
import type { FitColumn } from '../../../../../components/records/explorerFit.ts';

export const DOCUMENT_FIT: Record<'status' | 'review' | 'owner' | 'frameworks', Omit<FitColumn, 'key'>> = {
  status: { px: 116 },
  review: { px: 124 },
  owner: { px: 68, dropRank: 2, wide: { px: 176, titleMin: 420 } },
  frameworks: { px: 92, dropRank: 1 },
};

/** The columns in the order the table draws them, as the fit takes them. */
export const DOCUMENT_FIT_COLUMNS: FitColumn[] = (['status', 'review', 'owner', 'frameworks'] as const).map((key) => ({ key, ...DOCUMENT_FIT[key] }));
