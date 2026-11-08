// The KRI register's definition (facets, quick chips, sorts, board), apart from React (`kriModel.test.ts`). The rows are the KRI report's (GET /erm/kris/report?kind=kri), whose
// values are the server's: the live value of a fed KRI included. A KRI's state is lib/erm/kri.ts - the one rule the register, its board and the triggers tool share.
import { isDue, type Metric } from '../../governance/_metrics/metricModel.ts';
import { STATE_RANK, kriState, type KriState } from '../../../../lib/erm/kri.ts';
import { kriStatus } from '../../../../lib/statuses/monitoring.ts';
import { buildSchema, type RegisterDef } from '../../../../components/records/registerModel.ts';

export interface KriRow extends Metric {
  risk_id?: number | null;
  risk_title?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  last_measured_at?: string | null;
  reporting_period?: string | null;
}

export const stateOfRow = (k: KriRow): KriState => kriState(k);

const NONE = 'none';
const STATES: KriState[] = ['red', 'amber', 'green', 'unrated', 'no_value'];

const unique = <T,>(values: Array<T | null | undefined>): T[] => Array.from(new Set(values.filter((v): v is T => v !== null && v !== undefined && (v as unknown) !== '')));

export function kriDef(me: number | null): RegisterDef<KriRow> {
  return {
    key: 'kri',
    noun: { one: 'KRI', other: 'KRIs' },
    idOf: (k) => k.id,
    text: (k) => [k.name, k.category, k.risk_title, k.owner_name, k.is_live ? `live ${k.module_label ?? ''}` : 'manual', k.formula].filter(Boolean).join(' '),
    facets: [
      {
        key: 'status', label: 'Status', defaultOpen: true,
        values: (k) => [stateOfRow(k)],
        options: () => STATES.map((value) => ({ value, label: kriStatus.label(value) })),
      },
      {
        key: 'source', label: 'Source',
        values: (k) => [k.is_live ? 'live' : 'manual'],
        options: () => [{ value: 'manual', label: 'Entered by hand' }, { value: 'live', label: 'Live from the platform' }],
      },
      {
        key: 'category', label: 'Category', searchable: true, limit: 7,
        values: (k) => [k.category || NONE],
        options: (rows) => unique(rows.map((k) => k.category || null)).sort().map((value) => ({ value, label: value })).concat(rows.some((k) => !k.category) ? [{ value: NONE, label: 'No category' }] : []),
      },
      {
        key: 'risk', label: 'Linked risk', searchable: true, limit: 7,
        values: (k) => [k.risk_id ? String(k.risk_id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((k) => { if (k.risk_id) seen.set(String(k.risk_id), k.risk_title || `Risk ${k.risk_id}`); });
          const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
          return rows.some((k) => !k.risk_id) ? list.concat({ value: NONE, label: 'Not linked to a risk' }) : list;
        },
      },
      {
        key: 'owner', label: 'Owner', searchable: true, limit: 7,
        values: (k) => [k.owner_id ? String(k.owner_id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((k) => { if (k.owner_id) seen.set(String(k.owner_id), k.owner_name || `User ${k.owner_id}`); });
          const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
          return rows.some((k) => !k.owner_id) ? list.concat({ value: NONE, label: 'Unassigned' }) : list;
        },
      },
    ],
    quick: [
      { key: 'off', label: kriStatus.label('red'), test: (k) => stateOfRow(k) === 'red', title: 'Past the amber threshold: the same KRIs the Overview counts as red' },
      { key: 'watch', label: kriStatus.label('amber'), test: (k) => stateOfRow(k) === 'amber' },
      { key: 'due', label: 'Due', test: (k, now) => isDue(k.next_due_date, k.is_live, now), title: 'Entered by hand and the next measurement is due' },
      { key: 'novalue', label: kriStatus.label('no_value'), test: (k) => stateOfRow(k) === 'no_value' },
      ...(me != null ? [{ key: 'mine', label: 'Mine', test: (k: KriRow) => k.owner_id === me }] : []),
    ],
    sorts: [
      { key: 'status', label: 'Status (worst first)', firstDir: 'asc', value: (k) => STATE_RANK[stateOfRow(k)] },
      { key: 'name', label: 'Name', firstDir: 'asc', value: (k) => k.name },
      { key: 'value', label: 'Current value', firstDir: 'desc', value: (k) => k.current_value },
      { key: 'due', label: 'Next due', firstDir: 'asc', value: (k) => (k.next_due_date ? k.next_due_date.slice(0, 10) : null) },
      { key: 'owner', label: 'Owner', firstDir: 'asc', value: (k) => k.owner_name || null },
      { key: 'category', label: 'Category', firstDir: 'asc', value: (k) => k.category || null },
    ],
    defaultSort: { key: 'status', dir: 'asc' },
    board: {
      label: 'KRIs by state',
      columns: [
        { id: 'red', label: kriStatus.label('red'), test: (k) => stateOfRow(k) === 'red' },
        { id: 'amber', label: kriStatus.label('amber'), test: (k) => stateOfRow(k) === 'amber' },
        { id: 'green', label: kriStatus.label('green'), test: (k) => stateOfRow(k) === 'green' },
        { id: 'none', label: 'No value or not rated', test: () => true },
      ],
    },
    pageSize: 25,
  };
}

export const KRI_SCHEMA = buildSchema(kriDef(0))   // with a person, so every chip key is one the address may name;
export { NONE as KRI_NONE };
