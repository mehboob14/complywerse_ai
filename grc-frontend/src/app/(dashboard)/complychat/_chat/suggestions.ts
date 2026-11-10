// The questions offered in an empty chat, one per area (static: they are what the assistant is known to answer from the platform's own records).
export type SuggestionArea = 'frameworks' | 'evidence' | 'risks' | 'vulnerabilities';

export interface Suggestion { area: SuggestionArea; title: string; prompt: string }

export const SUGGESTIONS: readonly Suggestion[] = [
  { area: 'frameworks', title: 'Framework progress', prompt: 'Show framework progress overview and any active compliance journeys' },
  { area: 'evidence', title: 'Evidence gaps', prompt: 'List controls with missing or weak evidence that need attention' },
  { area: 'risks', title: 'Risk summary', prompt: 'Show the highest priority risks and their current treatment status' },
  { area: 'vulnerabilities', title: 'Open vulnerabilities', prompt: 'What critical vulnerabilities or remediation actions are still open?' },
];
