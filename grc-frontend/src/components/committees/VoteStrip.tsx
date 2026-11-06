'use client';

// The votes on one agenda item: four buttons (Agree, Partly agree, Disagree, Abstain) with how many chose each, ONE press casts or changes YOUR vote (a repeat of the same
// word changes nothing), a comment on your vote, the tally as a bar and, from "N votes", who voted what. Each person votes for themselves; the server asks only for a sign-in
// and the tally and the votes are visible to everyone in the tenant. One request per item (GET /meetings/agenda/{id}/votes), made when the item is opened, not for every item
// of a long agenda at once. A failed vote is a toast with Retry; "Vote recorded" is said after the server answered.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { committeeApi } from '@/lib/api';
import { Button, StatusPill, TextInput } from '@/components/ui/ds';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { agendaVote } from '@/lib/statuses/committees';

type Word = 'agreed' | 'partial' | 'disagreed' | 'abstain';
const WORDS: Word[] = ['agreed', 'partial', 'disagreed', 'abstain'];
const BAR: Record<Word, string> = { agreed: 'bg-ds-success', partial: 'bg-ds-warning', disagreed: 'bg-ds-danger', abstain: 'bg-ds-fg-muted' };

export function VoteStrip({ itemId, itemNumber }: { itemId: number; itemNumber: number }) {
  const [list, setList] = useState(false);
  const [note, setNote] = useState<string | null>(null);              // the comment being typed, null while closed
  const query = useQuery({
    queryKey: ['agenda-votes', itemId],
    queryFn: () => committeeApi.listAgendaVotes(itemId).then((r) => r.data),
    staleTime: 30 * 1000,
  });
  const vote = useReportedMutation({
    mutationFn: ({ word, comment }: { word: Word; comment?: string }) => committeeApi.voteAgendaItem(itemId, word, comment),
    success: (_r, v) => ({ title: 'Vote recorded', message: `Agenda item ${itemNumber}: ${agendaVote.label(v.word)}` }),
    failure: "Couldn't record the vote",
    invalidate: [['agenda-votes', itemId]],
    onSuccess: () => setNote(null),
  });

  const data = query.data;
  const tally = data?.tally ?? { agreed: 0, disagreed: 0, partial: 0, abstain: 0 };
  const total = data?.total ?? 0;
  const mine = (data?.my_vote?.vote as Word | undefined) ?? null;
  const myComment = data?.my_vote?.comment ?? '';

  return (
    <div role="group" aria-label={`Votes on agenda item ${itemNumber}`} className="space-y-[6px]">
      <div className="flex flex-wrap items-center gap-[6px]">
        {WORDS.map((word) => (
          <button
            key={word}
            type="button"
            aria-pressed={mine === word}
            disabled={vote.isPending}
            onClick={() => { if (mine !== word) vote.mutate({ word, comment: myComment || undefined }); }}
            className={`inline-flex h-ds-control-sm items-center gap-[4px] rounded-full border px-[10px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-wait ${mine === word ? 'border-ds-primary bg-ds-primary-soft font-[600] text-ds-primary-text' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover'}`}
          >
            {agendaVote.label(word)} <span className="font-normal text-ds-fg-muted">{tally[word] ?? 0}</span>
          </button>
        ))}
        {total > 0
          ? <Button variant="link" size="sm" aria-expanded={list} onClick={() => setList(!list)}>{`${formatCount(total)} ${total === 1 ? 'vote' : 'votes'}`}</Button>
          : <span className="text-ds-label font-normal text-ds-fg-muted">{query.isError ? "Couldn't load the votes" : query.isLoading ? 'Loading the votes…' : 'No votes yet'}</span>}
        {mine && note === null && <Button variant="link" size="sm" onClick={() => setNote(myComment)}>{myComment ? 'Edit comment' : 'Add comment'}</Button>}
        {query.isError && <Button variant="link" size="sm" onClick={() => { void query.refetch(); }}>Retry</Button>}
      </div>
      {total > 0 && (
        <span role="img" aria-label={WORDS.map((w) => `${tally[w] ?? 0} ${agendaVote.label(w)}`).join(', ')} className="flex h-[6px] max-w-[260px] overflow-hidden rounded-full bg-ds-border">
          {WORDS.map((w) => <span key={w} className={`block h-full ${BAR[w]}`} style={{ width: `${((tally[w] ?? 0) / total) * 100}%` }} />)}
        </span>
      )}
      {note !== null && mine && (
        <form
          className="flex flex-wrap items-center gap-[8px]"
          onSubmit={(e) => { e.preventDefault(); vote.mutate({ word: mine, comment: note.trim() }); }}
        >
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comment on your vote (optional)" aria-label={`Comment on your vote on item ${itemNumber}`} maxLength={500} className="min-w-[200px] flex-1" autoFocus />
          <Button type="submit" size="sm" variant="primary" loading={vote.isPending}>Save</Button>
          <Button size="sm" onClick={() => setNote(null)}>Cancel</Button>
        </form>
      )}
      {list && data && data.votes.length > 0 && (
        <ul className="space-y-[4px]">
          {data.votes.map((v) => (
            <li key={v.id} className="flex flex-wrap items-start gap-x-[8px] gap-y-[2px] text-ds-label font-normal text-ds-fg-body">
              <span className="min-w-0 break-words font-[500] text-ds-fg">{v.user_name || `User #${v.user_id}`}</span>
              <StatusPill size="sm" {...statusPill(agendaVote, v.vote)} />
              {v.comment && <span className="min-w-0 break-words text-ds-fg-muted">“{v.comment}”</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
