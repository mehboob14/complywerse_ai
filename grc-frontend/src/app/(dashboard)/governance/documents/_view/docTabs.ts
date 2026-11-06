// The strip of views on a document page: which of the eight are shown to this person and what each says beside its name. Pure, so node --test checks it
// (docTabs.test.ts). The names and their order are VIEWS (docRoute.ts, the one list); what is decided here is only who sees which, and the badge.
import { LIBRARY_VIEWS, VIEWS, type DocView } from './docRoute.ts';

export interface DocTab {
  key: DocView;
  label: string;
  /** a number beside the name (open remarks, requests waiting); absent when there are none */
  count?: number;
}

export interface DocTabsInput {
  /** the person may read the library (statements, mappings and gap analysis are its views) */
  library: boolean;
  /** the view that is open: Proposed changes stays in the strip while it is open even if the list is gone */
  open: DocView;
  /** changes proposed by people who are not the owner or author: the view exists once there is one */
  proposals: number;
  proposalsWaiting: number;
  openRemarks: number;
  pendingApprovals: number;
  /** the person has a step of their own to take (acknowledge, review, approve): Approvals says so instead of counting */
  yourStep: boolean;
}

const count = (n: number): number | undefined => (n > 0 ? n : undefined);

export function docTabs(i: DocTabsInput): DocTab[] {
  return VIEWS
    .filter((v) => (i.library || !LIBRARY_VIEWS.has(v.key)) && (v.key !== 'proposals' || i.proposals > 0 || i.open === 'proposals'))
    .map((v): DocTab => {
      if (v.key === 'approvals') return i.yourStep ? { key: v.key, label: `${v.label} · Your step` } : { key: v.key, label: v.label, count: count(i.pendingApprovals) };
      if (v.key === 'discussion') return { key: v.key, label: v.label, count: count(i.openRemarks) };
      if (v.key === 'proposals') return { key: v.key, label: v.label, count: count(i.proposalsWaiting) };
      return { key: v.key, label: v.label };
    });
}
