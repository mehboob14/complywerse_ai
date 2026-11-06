'use client';

// Governance > Settings > Exception approvals > Types: the kinds of exception the organisation tells apart ("Technical", "Third party"...). A person raising an
// exception chooses one, and a rule may be limited to some of them. The list is the organisation's own: rename a type, add one, remove one. A removed type is kept for
// the exceptions and rules that hold it (it is archived, still named there) and no new exception can choose it; Bring back puts it in use again. Nothing is saved until
// Save, the drawer asks "Discard changes?" before it throws edits away, and the server's refusal is said above the Save button with everything typed kept. The rules for
// what is allowed (no blank name, none twice, one left in use) are lib/exceptionRules.ts typeProblem, the server's own words.
import { useId, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { exceptionRulesApi } from '@/lib/api';
import { RULES_KEY, TYPES_KEY, TYPE_NAME_MAX, TYPE_NOTES, sameTypes, typeDrafts, typeProblem, typesPayload, type ExceptionTypeOption, type TypeDraft } from '@/lib/exceptionRules';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, IconButton, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';

export function TypesDrawer({ types, onClose }: { types: readonly ExceptionTypeOption[]; onClose: () => void }) {
  const [initial] = useState(() => typeDrafts(types));
  const [drafts, setDrafts] = useState<TypeDraft[]>(initial);
  const [adding, setAdding] = useState('');
  const [tried, setTried] = useState(false);
  const [said, setSaid] = useState<string | null>(null);                  // the server's sentence, as it is
  const listId = useId();

  const save = useReportedMutation({
    mutationFn: async (rows: ReturnType<typeof typesPayload>) => (await exceptionRulesApi.setTypes(rows)).data,
    success: 'Types saved',
    failure: 'Not saved',
    toast: 'success',                                                      // a refusal is the sentence above the Save button: one message per failure
    invalidate: [RULES_KEY, TYPES_KEY],
    onSuccess: onClose,
    onError: (e) => setSaid(errorMessage(e, 'The types could not be saved.')),
  });

  const change = (next: TypeDraft[]) => { setDrafts(next); setSaid(null); };
  const rename = (i: number, label: string) => change(drafts.map((d, j) => (j === i ? { ...d, label } : d)));
  const remove = (i: number) => change(drafts[i].value ? drafts.map((d, j) => (j === i ? { ...d, archived: true } : d)) : drafts.filter((_, j) => j !== i));
  const restore = (i: number) => change(drafts.map((d, j) => (j === i ? { ...d, archived: false } : d)));
  const add = () => {
    const label = adding.trim();
    if (!label) return;
    change([...drafts, { value: '', label, archived: false }]);
    setAdding('');
  };

  const problem = said ?? (tried ? typeProblem(drafts) : '');
  const submit = () => {
    setTried(true);
    if (typeProblem(drafts)) return;
    save.mutate(typesPayload(drafts));
  };
  const live = drafts.map((d, i) => ({ d, i })).filter(({ d }) => !d.archived);
  const removed = drafts.map((d, i) => ({ d, i })).filter(({ d }) => d.archived);

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={<span className="inline-flex items-center gap-[4px]">Exception types<InfoTip text={TYPE_NOTES.card} label="About exception types" /></span>}
      widthClassName="w-[520px] max-w-full"
      dirty={!sameTypes(drafts, initial) || adding.trim() !== ''}
      footer={(
        <div className="flex flex-col gap-[8px]">
          {problem && <p role="alert" className="text-ds-body text-ds-danger [overflow-wrap:anywhere]">{problem}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>Save types</Button>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <ul aria-label="Types" id={listId} className="flex flex-col gap-[8px]">
          {live.map(({ d, i }) => (
            <li key={d.value || `new-${i}`} className="flex items-center gap-[8px]">
              <TextInput aria-label="Type name" value={d.label} maxLength={TYPE_NAME_MAX} onChange={(e) => rename(i, e.target.value)} />
              <IconButton label={`Remove ${d.label || 'type'}`} onClick={() => remove(i)}><Trash2 aria-hidden /></IconButton>
            </li>
          ))}
        </ul>

        <form className="flex items-center gap-[8px]" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <TextInput aria-label="New type" placeholder="Add a type" value={adding} maxLength={TYPE_NAME_MAX} onChange={(e) => setAdding(e.target.value)} />
          <Button type="submit" leftIcon={<Plus aria-hidden />} disabled={!adding.trim()}>Add</Button>
        </form>

        {removed.length > 0 && (
          <section aria-label="Removed types" className="border-t border-ds-border pt-[12px]">
            <div className="flex items-center gap-[4px]">
              <h3 className="!text-ds-label !text-ds-fg-muted">Removed</h3>
              <InfoTip text={TYPE_NOTES.removed} label="About removed types" />
            </div>
            <ul className="mt-[4px] flex flex-col">
              {removed.map(({ d, i }) => (
                <li key={d.value} className="flex min-h-[36px] items-center justify-between gap-[8px]">
                  <span className="min-w-0 truncate text-ds-body text-ds-fg-muted" title={d.label}>{d.label}</span>
                  <Button size="sm" leftIcon={<RotateCcw aria-hidden />} onClick={() => restore(i)}>Bring back</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </RightSlidePanel>
  );
}
