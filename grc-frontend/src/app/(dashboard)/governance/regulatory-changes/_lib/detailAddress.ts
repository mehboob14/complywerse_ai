// What a change's page keeps in its address, on the kit's useAddressState: the tab (?tab=, kept by useTabParam), the obligation open (?obl=5), the obligations' filters (?oq= ?compliance= ?otype=
// ?control=met|review|none ?owner=7|none ?check=1) and the tasks' (?tq= ?tstatus= ?who=7|none ?late=1), the assessments' (?gaps=1). The Overview's links and the control page's card land
// here that way (…/12?tab=obligations&control=review). A value the page cannot be in is the default. Pure (no React).
import { flag, integer, oneOf, text } from '../../../../../lib/addressState.ts';
import { NO_OBLIGATION_FILTERS, type ObligationFilters } from './regulatoryModel.ts';

export const DETAIL_TABS = ['overview', 'obligations', 'assessments', 'tasks'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];
export const TAB_LABEL: Record<DetailTab, string> = { overview: 'Overview', obligations: 'Obligations', assessments: 'Impact', tasks: 'Tasks' };
/** Older names of the tabs. */
export const TAB_ALIASES: Record<string, DetailTab> = { impact: 'assessments', 'impact-assessments': 'assessments' };

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const DETAIL_SCHEMA = {
  oq: text(),
  compliance: text(),
  otype: text(),
  control: oneOf(['', 'met', 'review', 'none'] as const, ''),
  owner: text(),
  check: flag(),
  obl: integer(0, { min: 1 }),
  tq: text(),
  tstatus: text(),
  who: text(),
  late: flag(),
  gaps: flag(),
};

export interface DetailAddress {
  oq: string; compliance: string; otype: string; control: '' | 'met' | 'review' | 'none'; owner: string; check: boolean; obl: number;
  tq: string; tstatus: string; who: string; late: boolean; gaps: boolean;
}

export const obligationFiltersOf = (a: DetailAddress): ObligationFilters => ({ q: a.oq, compliance: a.compliance, type: a.otype, control: a.control, owner: a.owner, check: a.check });
export const obligationPatch = (f: ObligationFilters): Partial<DetailAddress> => ({ oq: f.q, compliance: f.compliance, otype: f.type, control: f.control as DetailAddress['control'], owner: f.owner, check: f.check });
export const NO_OBLIGATION_PATCH: Partial<DetailAddress> = obligationPatch(NO_OBLIGATION_FILTERS);

export interface TaskFilters { q: string; status: string; who: string; late: boolean }
export const NO_TASK_FILTERS: TaskFilters = { q: '', status: '', who: '', late: false };
export const taskFiltersOf = (a: DetailAddress): TaskFilters => ({ q: a.tq, status: a.tstatus, who: a.who, late: a.late });
export const taskPatch = (f: TaskFilters): Partial<DetailAddress> => ({ tq: f.q, tstatus: f.status, who: f.who, late: f.late });
export const taskFiltering = (f: TaskFilters): boolean => !!(f.q.trim() || f.status || f.who || f.late);
