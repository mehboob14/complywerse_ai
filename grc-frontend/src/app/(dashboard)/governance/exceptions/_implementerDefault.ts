'use client';

// The implementer of a NEW exception starts as its unit's default (Governance > Documents > Directory > the unit > Exceptions; `GET /governance/approval-defaults/resolve`, subject
// `exc_implementer`): the unit the exception is for, else its document's, else the organisation's. The field is filled while it is empty or still what the default put there; once the
// author has chosen (or cleared it) it is theirs and is left alone. The server fills an empty implementer again at submit and holds a locked default's people (400, in words), so
// this is only the starting point. A failed read starts nothing. Kept apart from the form: the form's guard (exceptionsPage.test.ts) keeps effects out of it.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readResolved, resolveKey } from '@/lib/approvalDefaultsApi';
import { implementerKeys, implementerNote, sameKeys } from '@/lib/approvalDefaults';

interface Started { keys: string[]; note: string; locked: boolean }

export function useImplementerDefault({ editing, unitId, people, setPeople }: {
  /** an exception that exists is not started from a default: it keeps its own */
  editing: boolean;
  unitId: number | null;
  /** the form's implementer people now ("user:12", "role:3", "unit_owner") */
  people: string[];
  setPeople: (keys: string[]) => void;
}): {
  /** "Default from Operations. You may change it." while the field is the default's, or always when the default is locked */
  hint: string | undefined;
  /** the default's people while the field still holds exactly them (the form is then no different from the one that opened); null once the author changed it */
  untouched: string[] | null;
} {
  const answer = useQuery({ queryKey: resolveKey(unitId, 'exc_implementer'), queryFn: () => readResolved(unitId, 'exc_implementer'), enabled: !editing, staleTime: 15_000, retry: false });
  const [started, setStarted] = useState<Started | null>(null);

  useEffect(() => {
    if (editing || !answer.data) return;
    const one = answer.data.subjects.exc_implementer;
    const keys = implementerKeys(one?.effective);
    const chosenByAuthor = started !== null && !sameKeys(people, started.keys);
    if (chosenByAuthor || (started === null && people.length > 0)) return;
    const locked = one?.effective?.locked === true;
    setStarted(keys.length ? { keys, note: implementerNote(one?.source ?? null, locked), locked } : null);
    if (!sameKeys(people, keys)) setPeople(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer.data]);

  const untouched = started !== null && sameKeys(people, started.keys) ? started.keys : null;
  return { hint: started !== null && (untouched !== null || started.locked) ? started.note : undefined, untouched };
}
