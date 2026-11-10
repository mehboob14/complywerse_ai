'use client';

// Comply Agent: the AI assistant as a page. Chats on the left (a Sheet below 1024px), the conversation in the middle, the box at the bottom. It asks the
// platform's own records and the files the person attached; every request ends as something the person can read (a table, a plain failure with Retry, a
// refusal by the data-protection guard in plain words). The top bar's question box lands here as `?q=`: it is asked once and taken out of the address.
// The rules are in chatModel.ts / askOutcome.ts / chatStore.ts (tested); this file draws the page and carries them out (useChat.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { List, MessageSquare, Plus, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/ds/Button';
import { Notice } from '@/components/ui/ds/Notice';
import { Sheet } from '@/components/ui/ds/Sheet';
import { SkeletonLines } from '@/components/ui/ds/Skeleton';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useNotify } from '@/components/ui/ds/useNotify';
import { ChatRail } from './ChatRail';
import { Composer, type ComposerHandle } from './Composer';
import { MessageView, type MessageActions } from './MessageView';
import { addressWith, questionFromAddress } from './chatModel';
import { SUGGESTIONS } from './suggestions';
import { useChat } from './useChat';

const INFO = 'Ask about your controls, evidence, risks, vulnerabilities and frameworks, or attach a document and ask about it. Answers come from your platform’s records and from the files you attach. Check important answers against the source.';

export function ChatPage() {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const chat = useChat({ confirm, notify });
  const composer = useRef<ComposerHandle>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useSearchParams();
  const [railOpen, setRailOpen] = useState(false);

  const { ready, active, activeId, select, startNew, submit } = chat;
  const messages = active?.messages ?? [];

  // `?c=<id>` opens that chat, once, when the chats have been read
  const opened = useRef(false);
  const wantedChat = search?.get('c') ?? '';
  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    if (wantedChat && chat.chats.some((c) => c.id === wantedChat)) select(wantedChat);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when ready
  }, [ready]);

  // `?q=<question>` (the top bar's box): asked once in a new chat, then taken out of the address. The same words asked again later (the box sends the
  // address again) are asked again: the memory below is cleared when the address has no question.
  const wantedQuestion = search ? questionFromAddress(search.toString()) : null;
  const taken = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!wantedQuestion) { taken.current = null; return; }
    if (taken.current === wantedQuestion) return;
    taken.current = wantedQuestion;
    const id = startNew();
    void submit(id, wantedQuestion);
    window.history.replaceState(null, '', addressWith(window.location.pathname, window.location.search, { q: null }));
  }, [ready, wantedQuestion, startNew, submit]);

  // the address names the open chat (so a reload or a shared tab lands in it), once it has something in it
  const hasContent = messages.length > 0;
  useEffect(() => {
    if (!ready || !activeId) return;
    const next = addressWith(window.location.pathname, window.location.search, { c: hasContent ? activeId : null });
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [ready, activeId, hasContent]);

  // the newest message is in view
  const last = messages[messages.length - 1];
  useEffect(() => {
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [activeId, messages.length, last?.id, last?.isLoading]);

  const newChat = useCallback(() => {
    startNew();
    setRailOpen(false);
    composer.current?.focus();
  }, [startNew]);

  const open = useCallback((id: string) => {
    select(id);
    setRailOpen(false);
    composer.current?.focus();
  }, [select]);

  const remove = useCallback(async (id: string) => {
    await chat.remove(id);
    composer.current?.focus();
  }, [chat]);

  const copy = useCallback((text: string) => {
    const failed = () => notify.error("Couldn't copy the answer. Select the text and copy it instead.");
    if (!navigator.clipboard) { failed(); return; }
    navigator.clipboard.writeText(text).then(() => notify.success('Answer copied'), failed);
  }, [notify]);

  const actions: MessageActions = {
    onRetry: (messageId) => chat.retry(activeId, messageId),
    onLoadMore: (messageId) => chat.loadMore(activeId, messageId),
    onEditQuestion: (question) => composer.current?.setText(question),
    onCopy: copy,
  };

  const rail = (
    <ChatRail chats={chat.chats} activeId={activeId} onSelect={open} onRename={chat.rename} onDelete={remove} />
  );
  const lost = chat.note.droppedChats;

  return (
    <div className="flex h-[calc(100vh-4.75rem)] min-h-[440px] flex-col gap-[12px] supports-[height:100dvh]:h-[calc(100dvh-4.75rem)]">
      <PageHeader
        variant="page"
        title="Comply Agent"
        info={INFO}
        actions={(
          <>
            <Button className="lg:hidden" leftIcon={<List aria-hidden />} onClick={() => setRailOpen(true)}>Chats</Button>
            <Button leftIcon={<Plus aria-hidden />} onClick={newChat}>New chat</Button>
          </>
        )}
      />
      {chat.note.unavailable && (
        <Notice tone="warning" title="Chats can't be kept in this browser">They are lost when you leave this page. Allow this site to store data to keep them.</Notice>
      )}
      {!chat.note.unavailable && lost > 0 && (
        <Notice tone="warning" title={`${lost} older ${lost === 1 ? 'chat' : 'chats'} can't be kept in this browser`}>{lost === 1 ? 'It is' : 'They are'} listed for now and gone when you leave this page. Delete chats you no longer need.</Notice>
      )}

      <div className="flex min-h-0 flex-1 gap-[12px]">
        <div className="hidden w-[260px] shrink-0 flex-col lg:flex">{rail}</div>
        <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
          <div
            ref={list}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Messages"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto px-[12px] py-[14px] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
          >
            {!ready ? (
              <SkeletonLines lines={4} label="Loading your chats" />
            ) : messages.length === 0 ? (
              <div className="mx-auto flex max-w-[640px] flex-col items-center py-[24px] text-center">
                <span aria-hidden className="mb-[12px] grid h-[40px] w-[40px] place-items-center rounded-ds-card bg-ds-primary-soft text-ds-primary-text">
                  <Sparkles className="h-[20px] w-[20px]" strokeWidth={1.75} />
                </span>
                <h2 className="!text-ds-section !text-ds-fg">Ask Comply Agent</h2>
                <p className="mt-[4px] max-w-[460px] text-ds-body text-ds-fg-muted">Start with a question below, or pick one of these.</p>
                <ul className="mt-[16px] grid w-full gap-2 text-left sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <li key={s.area}>
                      <button
                        type="button"
                        disabled={chat.busy}
                        onClick={() => void submit(activeId, s.prompt)}
                        className="flex min-h-[44px] w-full items-start gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MessageSquare aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-primary-text" strokeWidth={1.75} />
                        <span className="min-w-0">
                          <span className="block text-ds-body font-[600] text-ds-fg">{s.title}</span>
                          <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{s.prompt}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="grid gap-[14px]">
                {messages.map((m) => (
                  <MessageView key={m.id} message={m} busy={chat.busy} moreLoading={chat.moreFor === m.id} actions={actions} />
                ))}
              </ol>
            )}
          </div>
          <Composer
            ref={composer}
            attached={active?.attachments ?? []}
            busy={chat.busy && !chat.uploading}
            uploading={chat.uploading}
            onSubmit={(text, files) => chat.submit(activeId, text, files)}
            onStop={chat.stop}
          />
        </section>
      </div>

      <Sheet open={railOpen} onClose={() => setRailOpen(false)} title="Chats" width="sm" footer={<Button variant="primary" fullWidth leftIcon={<Plus aria-hidden />} onClick={newChat}>New chat</Button>}>
        {rail}
      </Sheet>
      {confirmDialog}
    </div>
  );
}
