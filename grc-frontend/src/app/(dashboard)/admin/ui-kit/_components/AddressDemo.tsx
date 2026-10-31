'use client';

// useAddressState and the rules behind it. A small "list page" whose search, status, tags, "mine" and page live in THIS page's address (the demo shows
// it as it changes: use Back, reload, or open the page with ?status=zzz&page=-4), and the calls of lib/addressState with their answers computed live.
// The Tabs demo above keeps ?tab= in the same address: a name the schema does not list is left alone.
import { useSearchParams } from 'next/navigation';
import {
  Button, Checkbox, FormField, RowHeaderCell, Select, Table, TBody, Td, Th, THead, TextInput, Tr, useAddressState,
} from '@/components/ui';
import { flag, integer, listOf, oneOf, readAddress, sortOf, text, writeAddress, type AddressState } from '@/lib/addressState';
import { MONO, Row, Specimen } from './Guide';

const STATUSES = ['all', 'draft', 'approved', 'expired'] as const;
const TAGS = ['policy', 'standard', 'procedure'] as const;

// outside the component, so the address is not read again on every render
const SCHEMA = {
  q: text(),
  status: oneOf(STATUSES, 'all'),
  tags: listOf(TAGS),
  mine: flag(),
  page: integer(1, { min: 1 }),
};
const NOTHING: AddressState<typeof SCHEMA> = { q: '', status: 'all', tags: [], mine: false, page: 1 };

export function AddressStateDemo() {
  const [state, set] = useAddressState(SCHEMA);
  const search = useSearchParams()?.toString() ?? '';
  const toggle = (tag: (typeof TAGS)[number], on: boolean) => set({ tags: on ? [...state.tags, tag] : state.tags.filter((t) => t !== tag), page: 1 });
  return (
    <Specimen label="Pick, type, press Next, then Back: the address follows each change (a search or a filter replaces the entry; Next adds one) and the page shows what the address says">
      <div className="space-y-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Search"><TextInput value={state.q} onChange={(e) => set({ q: e.target.value, page: 1 })} placeholder="Type, then look at the address" /></FormField>
          <FormField label="Status">
            <Select value={state.status} onChange={(e) => set({ status: e.target.value as (typeof STATUSES)[number], page: 1 })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </Select>
          </FormField>
        </div>
        <Row gap={16}>
          {TAGS.map((tag) => <Checkbox key={tag} label={tag} checked={state.tags.includes(tag)} onChange={(e) => toggle(tag, e.target.checked)} />)}
          <Checkbox label="Mine" checked={state.mine} onChange={(e) => set({ mine: e.target.checked, page: 1 })} />
        </Row>
        <Row>
          <Button size="sm" disabled={state.page <= 1} onClick={() => set({ page: state.page - 1 }, { push: true })}>Previous page</Button>
          <span className="text-ds-body text-ds-fg-body" aria-live="polite">Page {state.page}</span>
          <Button size="sm" onClick={() => set({ page: state.page + 1 }, { push: true })}>Next page (adds a history entry)</Button>
          <Button size="sm" variant="ghost" onClick={() => set(NOTHING)}>Reset</Button>
        </Row>
        <p className="break-all text-ds-label text-ds-fg-muted">Address now: <code className={MONO}>{`/admin/ui-kit${search ? `?${search}` : ''}`}</code></p>
      </div>
    </Specimen>
  );
}

const SHOW = (value: unknown): string => JSON.stringify(value);

const SORT = sortOf(['title', 'updated'], { key: 'updated', dir: 'desc' });
const CALLS: Array<[string, string]> = [
  ["readAddress(SCHEMA, '?status=approved&tags=policy,junk,standard&mine=1&page=3')", SHOW(readAddress(SCHEMA, '?status=approved&tags=policy,junk,standard&mine=1&page=3'))],
  ["readAddress(SCHEMA, '?status=zzz&page=-4&mine=maybe&tags=junk')  // junk is the default", SHOW(readAddress(SCHEMA, '?status=zzz&page=-4&mine=maybe&tags=junk'))],
  ["readAddress(SCHEMA, '?tags=policy&tags=standard,policy&status=draft&status=approved')  // repeats", SHOW(readAddress(SCHEMA, '?tags=policy&tags=standard,policy&status=draft&status=approved'))],
  ["writeAddress(SCHEMA, '?id=7&status=draft', { ...state, status: 'all' })  // the default is left out, id is kept", writeAddress(SCHEMA, '?id=7&status=draft', { ...NOTHING, status: 'all' })],
  ["writeAddress(SCHEMA, '', { q: '  data retention  ', tags: ['policy', 'standard'], page: 2, ... })", writeAddress(SCHEMA, '', { ...NOTHING, q: '  data retention  ', tags: ['policy', 'standard'], page: 2 })],
  ["readAddress({ sort: sortOf(['title', 'updated'], { key: 'updated', dir: 'desc' }) }, '?sort=Title:ASC')", SHOW(readAddress({ sort: SORT }, '?sort=Title:ASC'))],
  ["readAddress({ sort: … }, '?sort=none')  // cleared", SHOW(readAddress({ sort: SORT }, '?sort=none'))],
];

export function AddressParamsTable() {
  return (
    <div className="max-w-full overflow-x-auto rounded-ds-card border border-ds-border">
      <Table caption="The address rules, with their answers" className="min-w-[760px]">
        <THead><Tr><Th>Call</Th><Th>Answer</Th></Tr></THead>
        <TBody>
          {CALLS.map(([call, answer]) => (
            <Tr key={call}>
              <RowHeaderCell className="min-w-[340px] align-top"><code className={MONO}>{call}</code></RowHeaderCell>
              <Td className="align-top"><code className={`${MONO} text-ds-fg-body`}>{answer}</code></Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
