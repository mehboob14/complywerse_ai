'use client';

// A supplier's home in the supplier portal. Opened by a contact's personal link, usually on a phone, to do one thing, so it opens on ONE list: what is waiting on the
// supplier (questionnaires and requests together, soonest due first), then the supplier's conversation with us, then what is done. ?q=<id> goes straight to one
// questionnaire. The rules of the lists are portalHomeModel.ts.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Shield } from 'lucide-react';
import { Button, EmptyState, Tabs, TabPanel } from '@/components/ui/ds';
import { DoneItem, TodoItem } from '@/components/vendor-risk/supplier/PortalRows';
import { deepLink, doneRows, tabCounts, todoRows } from '@/components/vendor-risk/supplier/portalHomeModel';
import { Conversation, LinkGone, Loading, PortalProblem, Shell, day, fetchHome, problemOf, type PortalFailure, type PortalHome } from '../_shared';

type Tab = 'todo' | 'messages' | 'done';

export default function SupplierHomePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [home, setHome] = useState<PortalHome | null>(null);
  const [problem, setProblem] = useState<PortalFailure | null>(null);
  const [tab, setTab] = useState<Tab>('todo');

  useEffect(() => {
    let live = true;
    fetchHome(token).then((h) => {
      if (!live) return;
      const wanted = deepLink(h, Number(new URLSearchParams(window.location.search).get('q')));
      if (wanted) {
        router.replace(`/supplier/${token}/questionnaires/${wanted}`);
        return;
      }
      setHome(h);
    }).catch((e) => { if (live) setProblem(problemOf(e)); });
    return () => { live = false; };
  }, [token, router]);

  if (problem?.gone) return <LinkGone message={problem.message} />;
  if (problem) return <PortalProblem problem={problem} />;
  if (!home) return <Shell><Loading /></Shell>;

  const base = `/supplier/${token}`;
  const todo = todoRows(home);
  const done = doneRows(home);
  const counts = tabCounts(home);
  return (
    <Shell>
      <header className="rounded-xl border border-ds-border bg-ds-surface p-4 shadow-sm sm:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#b9ddd8] bg-[#e6f4f1] px-3 py-1 text-xs font-medium text-[#0b4f4a]">
          <Shield aria-hidden className="h-3.5 w-3.5" /> Supplier portal{home.organisation.name ? ` · ${home.organisation.name}` : ''}
        </span>
        <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight text-ds-fg">{home.supplier.name}</h1>
        <p className="mt-1 break-words text-sm text-ds-fg-body">
          {home.contact.name}{home.contact.email ? ` · ${home.contact.email}` : ''}
        </p>
        <p className="mt-0.5 text-xs text-ds-fg-body">Your link works until {day(home.expires_at)}.</p>
      </header>

      <Tabs<Tab> ariaLabel="Your portal" value={tab} onChange={setTab}
        tabs={[
          { key: 'todo', label: 'To do', count: counts.todo || undefined },
          { key: 'messages', label: 'Messages', count: counts.messages || undefined },
          { key: 'done', label: 'Done' },
        ]}>
        <TabPanel tabKey="todo" className="mt-4">
          {todo.length === 0 ? (
            <EmptyState kind="firstUse" bare title="Nothing is waiting for you"
              description={counts.messages > 0 ? `You have ${counts.messages} new message${counts.messages === 1 ? '' : 's'} from us.` : 'When we ask you for something, it appears here.'}
              action={counts.messages > 0 ? <Button variant="primary" onClick={() => setTab('messages')}>Read your messages</Button> : undefined} />
          ) : (
            <ul className="space-y-3">{todo.map((row) => <TodoItem key={row.key} base={base} row={row} />)}</ul>
          )}
        </TabPanel>
        <TabPanel tabKey="messages" className="mt-4">
          <div className="rounded-xl border border-ds-border bg-ds-surface p-4 shadow-sm">
            <Conversation token={token} initial={home.messages.latest} />
          </div>
        </TabPanel>
        <TabPanel tabKey="done" className="mt-4">
          {done.length === 0 ? (
            <EmptyState kind="firstUse" bare title="Nothing is done yet" description="What you have sent appears here." />
          ) : (
            <ul className="divide-y divide-ds-border rounded-xl border border-ds-border bg-ds-surface">
              {done.map((row) => <DoneItem key={row.key} base={base} row={row} />)}
            </ul>
          )}
        </TabPanel>
      </Tabs>
    </Shell>
  );
}
