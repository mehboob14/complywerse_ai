'use client';

// The two forms of the Feed: add a feed (a name, an address, who publishes it, how often to check) and choose who watches a feed (people and roles, from the list any signed-in person may read).
// Both are drawers that ask before typed input is thrown away, say what is wrong in words, show a failure in the drawer with what was typed kept, and confirm when it worked.
import { useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, MultiSelect, Select, TextInput, useReportedMutation, type ListOption } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { FEED_REFRESH, usePeople } from '../../regulatory-changes/_lib/data';
import { feedApi } from '../../regulatory-changes/_lib/api';
import type { FeedSource } from '../../regulatory-changes/_lib/types';
import { PeopleProblem } from '../../regulatory-changes/_parts/shared';
import { CATEGORIES, assigneeKey, feedFormProblem, parseAssignee } from './feedModel';

const EMPTY = { name: '', source_url: '', source_type: 'rss', regulator: '', country: '', category: 'general', poll_interval_hours: 24 };

export function AddFeedPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState('');
  const why = feedFormProblem(form);
  const close = () => { setForm(EMPTY); setShown(false); setProblem(''); onClose(); };
  const create = useReportedMutation({
    mutationFn: () => feedApi.createSource({ ...form, name: form.name.trim(), source_url: form.source_url.trim(), regulator: form.regulator.trim() || undefined, country: form.country.trim() || undefined }),
    success: { title: 'Feed added', message: 'Check it now from Manage sources, or it is read on its schedule.' }, failure: "Couldn't add the feed", retryable: false, toast: 'success',
    invalidate: FEED_REFRESH.map((k) => [...k]), onSuccess: close, onError: (e) => setProblem(errorMessage(e)),
  });
  const submit = () => { setProblem(''); if (why) { setShown(true); return; } create.mutate(); };
  return (
    <RightSlidePanel
      isOpen={open} onClose={close} dirty={JSON.stringify(form) !== JSON.stringify(EMPTY)} title="Add a feed" subtitle="Any RSS or Atom address a regulator publishes" width="w-full max-w-xl"
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={close}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={submit}>Add feed</Button></div>}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (!create.isPending) submit(); }}>
        <FormField label="Feed name" required error={shown && !form.name.trim() ? 'Give the feed a name.' : undefined}>
          <TextInput autoFocus value={form.name} maxLength={255} placeholder="e.g. SBP press releases" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <FormField label="Feed address" required hint="Starts with https://" error={shown && form.name.trim() && why ? why : undefined}>
          <TextInput type="url" value={form.source_url} maxLength={1000} placeholder="https://example.org/rss/feed.xml" onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Regulator" optional><TextInput value={form.regulator} maxLength={255} placeholder="e.g. SBP" onChange={(e) => setForm({ ...form, regulator: e.target.value })} /></FormField>
          <FormField label="Country" optional><TextInput value={form.country} maxLength={100} placeholder="e.g. Pakistan" onChange={(e) => setForm({ ...form, country: e.target.value })} /></FormField>
          <FormField label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
          </FormField>
          <FormField label="Check every" hint="1 to 168 hours.">
            <TextInput type="number" unit="hours" min={1} max={168} value={String(form.poll_interval_hours)} onChange={(e) => setForm({ ...form, poll_interval_hours: parseInt(e.target.value, 10) || 0 })} />
          </FormField>
        </div>
        {problem && <p role="alert" className="m-0 text-ds-body text-ds-danger">{problem}</p>}
      </form>
    </RightSlidePanel>
  );
}

/** Who watches a feed: people and roles. The people are told about nothing here; they are the ones the Overview's "Feed to triage" and My work count for. */
export function AssignPanel({ source, onClose }: { source: FeedSource | null; onClose: () => void }) {
  const people = usePeople();
  const start = useMemo(() => (source?.assignees ?? []).map(assigneeKey), [source]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [problem, setProblem] = useState('');
  const value = chosen ?? start;
  const options: ListOption[] = useMemo(() => {
    const list: ListOption[] = people.users.map((u) => ({ value: `user:${u.id}`, label: u.display_name, description: u.department || u.email || undefined }))
      .concat(people.roles.map((r) => ({ value: `role:${r.id}`, label: `Role: ${r.name}`, description: `${r.user_count} ${r.user_count === 1 ? 'person' : 'people'}` })));
    // someone already on the feed who is not in the list any more is kept, by the name the feed carries
    const extra = (source?.assignees ?? []).filter((a) => !list.some((o) => o.value === assigneeKey(a))).map((a) => ({ value: assigneeKey(a), label: a.name || (a.type === 'role' ? 'A role no longer here' : 'Someone no longer here') }));
    return extra.concat(list);
  }, [people.users, people.roles, source]);
  const close = () => { setChosen(null); setProblem(''); onClose(); };
  const save = useReportedMutation({
    mutationFn: () => feedApi.assign((source as FeedSource).id, value.map(parseAssignee).filter((a): a is NonNullable<ReturnType<typeof parseAssignee>> => !!a)),
    success: 'Watchers saved', failure: "Couldn't save who watches the feed", toast: 'success', invalidate: FEED_REFRESH.map((k) => [...k]), onSuccess: close, onError: (e) => setProblem(errorMessage(e)),
  });
  return (
    <RightSlidePanel
      isOpen={!!source} onClose={close} dirty={chosen !== null && chosen.join(',') !== start.join(',')} title={source ? `Who watches ${source.name}` : 'Who watches this feed'} width="w-full max-w-xl"
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={close}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => { setProblem(''); save.mutate(); }}>Save</Button></div>}
    >
      <div className="flex flex-col gap-[16px]">
        <p className="m-0 text-ds-body text-ds-fg-muted">The people and roles who look after new items from this feed. Their new items count in My work.</p>
        <FormField label="People and roles">
          <MultiSelect label="People and roles" options={options} value={value} onChange={setChosen} display="chips" placeholder={people.isPending ? 'Loading people…' : 'Choose people or roles'} />
        </FormField>
        <PeopleProblem q={people} />
        {problem && <p role="alert" className="m-0 text-ds-body text-ds-danger">{problem}</p>}
      </div>
    </RightSlidePanel>
  );
}
