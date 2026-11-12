// What each part of the Governance Overview shows, as a plain list of measures, so a test can prove that no measure is drawn twice on a view (sections.test.ts reads
// this list against the sources, so it cannot drift from the page). A measure is a count, the distribution of a count, or the rows of a table; a fact appears once on a
// view. A tile is a headline that is not one slice of a distribution drawn on the same view; a graphic and the table of the same measure live in different views (the
// Summary has the graphic of the biggest five departments, the Departments view the table of all of them). The ids of a card are the `id` of its element.

export interface Section { id: string; shows: readonly string[] }

/** The five figures the Summary opens with, by the key of their tile (visualsModel.ts heroTiles). */
export const SUMMARY_TILES: Readonly<Record<string, string>> = {
  score: 'governance.score',
  documents: 'documents.total',
  coverage: 'documents.coverage',
  attention: 'documents.with_issues',
  published: 'documents.published_6m',
};

/** The cards of the Summary, in the order of the page. */
export const SUMMARY_CARDS: readonly Section[] = [
  { id: 'section-scores', shows: ['sections.scores'] },
  { id: 'by-status', shows: ['documents.by_status'] },
  { id: 'by-type', shows: ['documents.by_type'] },
  { id: 'reviews', shows: ['reviews.by_state'] },
  { id: 'waiting', shows: ['requests.waiting'] },
  { id: 'by-department', shows: ['documents.by_department_top5'] },
  { id: 'throughput', shows: ['documents.created_and_published'] },
  { id: 'expiring', shows: ['documents.expiring_90d'] },
  { id: 'exceptions', shows: ['exceptions.by_status'] },
  { id: 'work', shows: ['work.mine'] },
];

/** The Departments view: the table of the scope's departments, and the frameworks (the graphic of where the attention sits, and the table of every framework). */
export const DEPARTMENT_SECTIONS: readonly Section[] = [
  { id: 'departments', shows: ['departments.matrix'] },
  { id: 'attention-map', shows: ['frameworks.attention_approval_expiring_exceptions'] },
  { id: 'frameworks', shows: ['frameworks.table'] },
];

/** The Board view: the documents themselves, as cards. */
export const BOARD_SECTIONS: readonly Section[] = [{ id: 'board', shows: ['documents.cards'] }];

/** The measures that are on more than one view, each as the graphic on one and the table on the other. */
export const GRAPHIC_AND_TABLE: Readonly<Record<string, readonly [string, string]>> = {
  departments: ['documents.by_department_top5', 'departments.matrix'],
};

/** Every measure shown on a view, in order (a tile's first). */
export const measuresOf = (tiles: Readonly<Record<string, string>>, sections: readonly Section[]): string[] => [...Object.values(tiles), ...sections.flatMap((s) => s.shows)];

/** The first measure that appears twice in a list, or null. */
export const firstRepeat = (measures: readonly string[]): string | null => measures.find((m, i) => measures.indexOf(m) !== i) ?? null;
