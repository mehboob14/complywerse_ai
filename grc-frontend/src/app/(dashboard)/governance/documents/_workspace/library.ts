// Small rules of the documents library page. Pure (no React), so `node --test` runs library.test.ts against it.

const PLURALS: Record<string, string> = {
  policy: 'Policies', standard: 'Standards', procedure: 'Procedures', guideline: 'Guidelines', charter: 'Charters', framework: 'Frameworks',
};

/** The breadcrumb's name for a document type: "Policies", never "Policys". */
export const pluralType = (docType: string): string => PLURALS[docType] ?? 'Other documents';

export type ViewMode = 'tree' | 'table' | 'board';
export const VIEW_KEY = 'governance-documents-view';

const viewOf = (v: unknown): ViewMode => (v === 'tree' || v === 'board' ? v : 'table');

/** The view this browser chose last (Table when none, or when the browser keeps nothing). */
export function rememberedView(): ViewMode {
  try {
    return viewOf(window.localStorage.getItem(VIEW_KEY));
  } catch {
    return 'table';
  }
}

export function rememberView(v: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    // a private window or blocked storage: not remembered
  }
}

/** New Document, AI Draft and Templates all open the Comply AI Studio: where it is off, one line says so instead. */
export function creation(canCreate: boolean, studioEnabled: boolean | undefined): 'buttons' | 'studio-off' | null {
  if (!canCreate) return null;
  return studioEnabled === false ? 'studio-off' : 'buttons';
}
