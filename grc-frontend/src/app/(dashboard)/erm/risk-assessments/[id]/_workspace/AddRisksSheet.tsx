'use client';

/**
 * "Add risks to the assessment": a right-hand sheet with a search box and the register's risks that are not in the assessment yet. The old panel listed the first 100 by title with no search, so
 * a register of more than 100 could not be assessed in full; this one asks the server for the matches (`search`, 50 at a time, "Load more"), keeps what is ticked while the search changes, and
 * says what it did ("12 risks added"). Each risk shows its level from the one band system.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button, Checkbox, ErrorState, Sheet, SkeletonRows, StatusPill, TextInput, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import { bandOf, levelScore } from '../../_register/assessmentModel';
import { ASSESSMENT_REFRESH } from '../../_register/assessmentData';
import { assessmentKey } from './workspaceData';

interface Candidate { id: number; title: string; category?: string | null; inherent_score?: number | null; residual_score?: number | null }
const PAGE = 50;

export function AddRisksSheet({ assessmentId, open, onClose }: { assessmentId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [search, setSearch] = useState('');
  const [asked, setAsked] = useState('');
  const [items, setItems] = useState<Candidate[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const seq = useRef(0);

  const fetchPage = useCallback(async (term: string, skip: number): Promise<Candidate[]> => {
    const res = await ermApi.riskAssessments.getAvailableRisks(assessmentId, { skip, limit: PAGE, search: term.trim() || undefined });
    return res.data as unknown as Candidate[];
  }, [assessmentId]);

  const load = useCallback(async (term: string) => {
    const mine = ++seq.current;
    setState('loading');
    try {
      const rows = await fetchPage(term, 0);
      if (mine !== seq.current) return;
      setItems(rows);
      setMore(rows.length === PAGE);
      setAsked(term);
      setState('ready');
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e);
      setState('error');
    }
  }, [fetchPage]);

  // the first page when the sheet opens; a new search after a pause
  useEffect(() => { if (open) void load(''); else { setSearch(''); setPicked(new Map()); setItems([]); } }, [open, load]);
  useEffect(() => {
    if (!open || search.trim() === asked.trim()) return undefined;
    const t = setTimeout(() => { void load(search); }, 250);
    return () => clearTimeout(t);
  }, [search, asked, open, load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await fetchPage(asked, items.length);
      setItems((cur) => [...cur, ...rows.filter((r) => !cur.some((c) => c.id === r.id))]);
      setMore(rows.length === PAGE);
    } catch (e) {
      notify.error(errorMessage(e), { title: "Couldn't load more risks", retry: () => { void loadMore(); } });
    } finally {
      setLoadingMore(false);
    }
  };

  const add = useReportedMutation({
    mutationFn: (ids: number[]) => ermApi.riskAssessments.bulkAddRisks(assessmentId, ids),
    success: (_d, ids) => ({ title: ids.length === 1 ? 'Risk added' : 'Risks added', message: `${formatCount(ids.length)} ${ids.length === 1 ? 'risk is' : 'risks are'} in the assessment. Score them in the table.` }),
    failure: "Couldn't add the risks",
    invalidate: [[...assessmentKey(assessmentId)], ...ASSESSMENT_REFRESH],
    onSuccess: () => { setPicked(new Map()); onClose(); },
  });

  const toggle = (c: Candidate) => setPicked((cur) => { const next = new Map(cur); if (next.has(c.id)) next.delete(c.id); else next.set(c.id, c.title); return next; });
  void qc;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add risks to the assessment"
      subtitle="Risks from the Risk Register that are not in it yet"
      width="md"
      dirty={picked.size > 0}
      initialFocus="input[type=search]"
      footer={(
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="text-ds-body text-ds-fg-muted">{formatCount(picked.size)} selected</span>
          <span className="ml-auto flex gap-[8px]">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={add.isPending} disabled={picked.size === 0} onClick={() => add.mutate(Array.from(picked.keys()))}>
              {picked.size === 0 ? 'Add risks' : `Add ${formatCount(picked.size)} ${picked.size === 1 ? 'risk' : 'risks'}`}
            </Button>
          </span>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the register's risks by title" placeholder="Search risks by title" autoComplete="off" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} />
        {state === 'loading' && items.length === 0 && <SkeletonRows rows={6} columns={2} label="Loading the risks" />}
        {state === 'error' && <ErrorState compact title="Couldn't load the risks" message={errorMessage(error)} onRetry={canRetry(error) ? () => { void load(search); } : undefined} />}
        {state === 'ready' && items.length === 0 && (
          <p role="status" className="m-0 text-ds-body text-ds-fg-muted">{asked.trim() ? 'No risk in the register has those words in its title.' : 'Every risk in the register is already in this assessment.'}</p>
        )}
        {items.length > 0 && (
          <ul aria-busy={state === 'loading' || undefined} className="m-0 list-none p-0">
            {items.map((c) => {
              const band = bandOf(levelScore({ residual_score: c.residual_score, inherent_score: c.inherent_score }));
              return (
                <li key={c.id} className="border-b border-ds-border last:border-b-0">
                  <label className="flex min-h-[52px] cursor-pointer items-start gap-[10px] px-[4px] py-[8px] hover:bg-ds-surface-hover">
                    <Checkbox checked={picked.has(c.id)} onChange={() => toggle(c)} aria-label={`Add ${c.title}`} />
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{c.title}</span>
                      <span className="mt-[2px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label text-ds-fg-muted">
                        {c.category && <span>{c.category.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())}</span>}
                        {c.inherent_score != null && <span>Inherent {Math.round(c.inherent_score)}</span>}
                        {c.residual_score != null && <span>Residual {Math.round(c.residual_score)}</span>}
                      </span>
                    </span>
                    <StatusPill size="sm" {...statusPill(riskLevel, band)} />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {more && state === 'ready' && <Button loading={loadingMore} onClick={() => { void loadMore(); }}>Load more</Button>}
        {state === 'ready' && !more && items.length >= PAGE && <p className="m-0 text-ds-label text-ds-fg-muted">That is every match.</p>}
      </div>
    </Sheet>
  );
}
