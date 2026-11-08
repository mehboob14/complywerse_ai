'use client';

// The answers of one unit, saved as the person types. Every change marks its question as unsaved and schedules ONE save of the questions that changed since the last one (a choice
// waits a moment so a quick second tap joins the first; text waits for a pause or for the field to lose focus). A save sends each changed question whole, under the field names the
// API stores (lib/rcsa/answers.savePayload): the server overwrites a question's stored row with what it is sent, so a partial body would blank the rest. While a save runs, new
// changes queue behind it and go in the next. A failed save keeps the questions unsaved, says so, and Retry sends them again; leaving the page asks first, and a page that is
// closed in the middle of a save gets a last attempt. `flush()` is what Submit waits for: it resolves true only when nothing is left unsaved.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rcsaApi } from '@/lib/api';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { savePayload, type Answer, type Question } from '@/lib/rcsa/answers';

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export interface AnswersApi {
  answers: Readonly<Record<number, Answer>>;
  /** replace a question's answer; `wait` is how long to wait for more changes before saving (ms) */
  change: (questionId: number, next: Answer, wait?: number) => void;
  /** save now what is unsaved; true when nothing is left unsaved */
  flush: () => Promise<boolean>;
  state: SaveState;
  savedAt: Date | null;
  error: string | null;
  unsaved: number;
}

export function useAnswers(assessmentId: number, questions: readonly Question[], initial: Record<number, Answer>, editable: boolean): AnswersApi {
  const [answers, setAnswers] = useState<Record<number, Answer>>(initial);
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(0);
  const latest = useRef(answers);
  const dirty = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const running = useRef<Promise<boolean> | null>(null);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);

  const flush = useCallback(async function flushNow(): Promise<boolean> {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    if (running.current) await running.current;                       // what is being saved finishes first; what changed meanwhile goes after it
    const ids = Array.from(dirty.current).filter((id) => byId.has(id));
    if (ids.length === 0) { dirty.current.clear(); setUnsaved(0); return true; }
    const sent = new Map(ids.map((id) => [id, latest.current[id]]));
    const body = { responses: ids.map((id) => savePayload(byId.get(id) as Question, latest.current[id] ?? {})) };
    setState('saving');
    const run = (async () => {
      try {
        await rcsaApi.saveResponses(assessmentId, body);
        ids.forEach((id) => { if (latest.current[id] === sent.get(id)) dirty.current.delete(id); });      // changed again while it was saving: stays unsaved
        setSavedAt(new Date());
        setError(null);
        setUnsaved(dirty.current.size);
        setState(dirty.current.size > 0 ? 'unsaved' : 'saved');
        return true;
      } catch (e) {
        setError(errorMessage(e, "Your answers couldn't be saved."));
        setState('error');
        return false;
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    const ok = await run;
    return ok && dirty.current.size > 0 ? flushNow() : ok && dirty.current.size === 0;
  }, [assessmentId, byId]);

  const change = useCallback((questionId: number, next: Answer, wait = 400) => {
    if (!editable) return;
    latest.current = { ...latest.current, [questionId]: next };
    setAnswers(latest.current);
    dirty.current.add(questionId);
    setUnsaved(dirty.current.size);
    setState((s) => (s === 'saving' ? s : 'unsaved'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, wait);
  }, [editable, flush]);

  // leaving the page with something unsaved asks first; a last attempt is made when the page goes away
  useEffect(() => {
    const ask = (e: BeforeUnloadEvent) => {
      if (dirty.current.size === 0 && !running.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => {
      window.removeEventListener('beforeunload', ask);
      if (dirty.current.size > 0) void flush();
    };
  }, [flush]);

  return { answers, change, flush, state, savedAt, error, unsaved };
}
