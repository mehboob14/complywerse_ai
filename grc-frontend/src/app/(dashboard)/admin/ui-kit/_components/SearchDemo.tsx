'use client';

// DebouncedSearch and FormError, live: a list that is asked once after the person stops typing, every way the box can be cleared or reset by the page, and the
// inline failure of a save (with a Retry that works the second time, and a refusal that offers none). Static fixtures only: nothing here calls the API.
import { useEffect, useRef, useState } from 'react';
import { Button, DebouncedSearch, FormError } from '@/components/ui';
import { Specimen } from './Guide';

const NOTE = 'text-ds-label text-ds-fg-muted';
const FRAME = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
const NAMES = ['Access control policy', 'Acceptable use policy', 'Business continuity plan', 'Data retention schedule', 'Incident response playbook', 'Information security policy', 'Password guideline', 'Remote working standard', 'Retention of audit logs', 'Third-party risk standard', 'Vendor onboarding procedure', 'Web application firewall standard'];
const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function SearchDemoInner() {
  const [query, setQuery] = useState('');
  const [asks, setAsks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const ask = (q: string) => {
    setQuery(q);
    setAsks((a) => a.concat([q]));
    setBusy(true);                                                                    // the simulated list answers after a moment
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBusy(false), 700);
  };
  const words = fold(query).split(/\s+/).filter(Boolean);
  const shown = NAMES.filter((n) => words.every((w) => fold(n).indexOf(w) >= 0));
  return (
    <div className="space-y-[8px]">
      <div className={`${FRAME} max-w-[420px] space-y-[8px]`}>
        <DebouncedSearch label="Search policies" placeholder="Search policies" value={query} onSearch={ask} loading={busy} />
        <ul aria-label="Documents found" className="space-y-[2px] text-ds-body text-ds-fg-body" data-guide-search-list>
          {shown.map((n) => <li key={n}>{n}</li>)}
          {shown.length === 0 && <li className="text-ds-fg-muted">No documents match</li>}
        </ul>
      </div>
      <p className={NOTE} aria-live="polite" data-guide-search-log>
        The list was asked {asks.length} {asks.length === 1 ? 'time' : 'times'}{asks.length > 0 ? `; last for ${asks[asks.length - 1] === '' ? 'everything' : `"${asks[asks.length - 1]}"`}` : ''}. Query held by the page: {query === '' ? 'none' : `"${query}"`}.
      </p>
      <div className="flex flex-wrap gap-[8px]">
        <Button size="sm" data-guide-search-reset onClick={() => ask('')}>Clear filters (the page resets the query)</Button>
        <Button size="sm" data-guide-search-link onClick={() => ask('retention')}>Follow a link with ?q=retention</Button>
      </div>
    </div>
  );
}

export function SearchDemo() {
  return (
    <div className="space-y-[16px]">
      <Specimen label="Type a word: the list is asked once, 300 ms after the last letter. Enter asks at once; Escape (with text) or the × clears the box and asks for everything; the page can reset the query itself">
        <SearchDemoInner />
      </Specimen>
      <Specimen label="A long placeholder in a 220 px box: it is cut, and the box is never wider than its column">
        <div className={`${FRAME} max-w-[220px]`}><DebouncedSearch label="Search the registry of every policy, standard and procedure" placeholder="Search the registry of every policy, standard and procedure" value="" onSearch={() => undefined} /></div>
      </Specimen>
    </div>
  );
}

type Failure = 'busy' | 'refused' | 'silent' | null;
const serverError = (status: number, detail: string) => ({ isAxiosError: true, message: `Request failed with status code ${status}`, response: { status, data: { detail } } });

export function FormErrorDemo() {
  const attempts = useRef(0);
  const [problem, setProblem] = useState<unknown>(null);
  const [saved, setSaved] = useState('nothing saved yet');
  const [failure, setFailure] = useState<Failure>(null);
  const save = (kind: Exclude<Failure, null>) => {
    setFailure(kind);
    attempts.current += 1;
    if (kind === 'busy' && attempts.current % 2 === 0) { setProblem(null); setSaved('saved on the second try'); return; }
    setSaved('not saved');
    setProblem(kind === 'busy' ? serverError(503, 'The server is busy. Try again.') : kind === 'refused' ? serverError(409, 'Someone else changed this document. Reload it and try again.') : serverError(500, ''));
  };
  return (
    <div className="space-y-[16px]">
      <Specimen label="A save that fails: the server's words once, at the top of the form, and a Retry that repeats the save (it works the second time). A refusal (409) offers none; a server that said nothing uses the fallback">
        <div className={`${FRAME} max-w-[560px] space-y-[8px]`}>
          <FormError title="Couldn't save the document" error={problem} fallback="The document could not be saved. Your changes are still here." onRetry={failure ? () => save(failure) : undefined} />
          <div className="flex flex-wrap gap-[8px]">
            <Button size="sm" data-guide-formerror="busy" onClick={() => { attempts.current = 0; save('busy'); }}>Save and fail (503, works on Retry)</Button>
            <Button size="sm" data-guide-formerror="refused" onClick={() => save('refused')}>Save and be refused (409)</Button>
            <Button size="sm" data-guide-formerror="silent" onClick={() => save('silent')}>Save and the server says nothing (500)</Button>
          </div>
          <p className={NOTE} aria-live="polite" data-guide-formerror-log>Now: {saved}.</p>
        </div>
      </Specimen>
      <Specimen label="Nothing failed: nothing is drawn (not even an empty banner)">
        <div className={`${FRAME} max-w-[560px]`}><FormError title="Couldn't save the document" error={null} /><p className={NOTE}>(end of the specimen)</p></div>
      </Specimen>
    </div>
  );
}
