'use client';

/**
 * Checks on the document. The ones that need no AI (headings and numbering, spacing, repeated words, lists, tables, the
 * sections the document type requires, placeholders still to fill in, the entity name and logo) run on every saved change.
 * Comply Agent's check proofreads spelling, grammar and wording. Clicking an item shows and highlights its place in the
 * document; a fix is one click, and "Apply all fixes" applies every fix offered (Comply Agent's suggestions and added sections
 * too) as one revision that History can undo.
 *
 * On the design-system kit: the buttons are the kit's, a whole row is the target (it was the text line only: 19px), and a check that
 * could not run says so with a Retry: it never reads "No issues".
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleAlert, Info, MapPin, Sparkles, Wand2 } from 'lucide-react';
import { isConflict, studioApi, type Issue, type Message, type Session } from '@/lib/studio/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, SkeletonRows, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { plural } from '@/lib/studio/text';

/** `note`: what a group's short name cannot say, as an (i) beside it. `terse`: a row is only the quoted text (every row of the group has the same message, the (i) says it once). */
const GROUPS: { key: string; label: string; note?: string; terse?: boolean; test: (i: Issue) => boolean }[] = [
  { key: 'fill', label: 'To fill in', note: 'Each must be filled in before the document is used.', terse: true, test: (i) => i.rule === 'placeholder' },
  { key: 'language', label: 'Wording', note: 'Spelling, grammar, style and consistency.', test: (i) => ['spelling', 'grammar', 'style', 'consistency'].includes(i.kind) },
  { key: 'format', label: 'Formatting', test: (i) => i.kind === 'format' },
  { key: 'structure', label: 'Structure', test: (i) => i.kind === 'structure' },
  { key: 'entity', label: 'Entity and logo', test: (i) => i.kind === 'entity' || i.kind === 'logo' },
  { key: 'sign', label: 'Signature lines', note: 'Filled in when the document is signed.', test: (i) => i.rule === 'placeholder_signature' },
];

// stable empties: a new [] on every render would re-run the effects that depend on them
const NO_ISSUES: Issue[] = [];

function Severity({ level }: { level: Issue['severity'] }) {
  if (level === 'error') return <CircleAlert className="h-4 w-4 shrink-0 text-ds-danger" aria-label="Error" />;
  if (level === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-ds-warning" aria-label="Warning" />;
  return <Info className="h-4 w-4 shrink-0 text-ds-info" aria-label="Note" />;
}

function IssueRow({ issue, active, onGoTo, onFix, fixing, terse }: { issue: Issue; active: boolean; onGoTo: (i: Issue) => void; onFix: (i: Issue) => void; fixing: boolean; terse?: boolean }) {
  const located = issue.block != null || !!issue.quote;
  return (
    <li className={`flex items-stretch gap-1 rounded-ds-card border ${active ? 'border-ds-warning bg-ds-warning-soft ring-1 ring-ds-warning' : 'border-ds-border bg-ds-surface hover:border-ds-primary'}`}>
      {/* the whole row is the button (it was the text line only): a target of the row's height */}
      <button type="button" disabled={!located} onClick={() => onGoTo(issue)} aria-pressed={active} title={located ? 'Show and highlight it in the document' : undefined}
        className="flex min-h-[var(--ds-control-h)] min-w-0 flex-1 items-start gap-2 rounded-ds-card px-[10px] py-[8px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-default">
        <span className="mt-0.5"><Severity level={issue.severity} /></span>
        <span className="min-w-0 flex-1 text-ds-body">
          {!(terse && issue.quote) && <span className="block text-ds-fg">{issue.message}</span>}
          {issue.quote && <span className={terse ? 'block truncate text-ds-fg' : 'mt-0.5 block truncate text-ds-label italic text-ds-fg-muted'} title={terse ? `${issue.message} ${issue.quote}` : issue.quote}>“{issue.quote}”</span>}
          {issue.suggestion && <span className="mt-0.5 block text-ds-label text-ds-success">Suggestion: {issue.suggestion}</span>}
        </span>
        {located && <MapPin className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-ds-warning' : 'text-ds-fg-muted'}`} aria-hidden />}
      </button>
      {issue.fix && (
        <div className="flex shrink-0 items-center pr-[6px]">
          <Button size="sm" leftIcon={<Wand2 aria-hidden />} loading={fixing} onClick={() => onFix(issue)} title="Fix it">Fix</Button>
        </div>
      )}
    </li>
  );
}

export interface ChecksPanelProps {
  session: Session;
  aiConfigured: boolean;
  /** save what is being typed so the checks see it */
  flush: () => Promise<void>;
  /** a fix changed the document */
  onContent: (content: string, revision: number) => void;
  onGoTo: (issue: Issue) => void;
  onIssues: (issues: Issue[]) => void;
  onNextPlaceholder: () => void;
}

export default function ChecksPanel({ session, aiConfigured, flush, onContent, onGoTo, onIssues, onNextPlaceholder }: ChecksPanelProps) {
  const notify = useNotify();
  const qc = useQueryClient();
  const [aiMessage, setAiMessage] = useState<Message | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const local = useQuery({
    queryKey: ['studio', 'checks', session.id, session.revision, session.instructions.entity_name ?? '', session.instructions.logo_asset_id ?? 0, session.instructions.logo_required ?? false],
    queryFn: () => studioApi.checks(session.id),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
  const lastAi = useQuery({ queryKey: ['studio', 'ai-check', session.id], queryFn: () => studioApi.lastAiCheck(session.id), staleTime: 15_000 });

  // an AI check in progress: poll it until it is done
  const working = aiMessage?.status === 'working';
  useEffect(() => {
    if (!aiMessage || aiMessage.status !== 'working') return;
    const t = setInterval(async () => {
      try {
        const m = await studioApi.message(session.id, aiMessage.id);
        setAiMessage(m);
        if (m.status !== 'working') {
          clearInterval(t);
          qc.invalidateQueries({ queryKey: ['studio', 'ai-check', session.id] });
          if (m.status === 'error') notify.error(m.error, { title: 'The check did not finish' });
        }
      } catch { /* try again on the next tick */ }
    }, 1500);
    return () => clearInterval(t);
  }, [aiMessage, session.id, qc, notify]);

  const runAi = useMutation({
    mutationFn: async () => { await flush(); return studioApi.checks(session.id, true); },
    onSuccess: (r) => { if (r.ai_message) setAiMessage(r.ai_message); },
    onError: (e) => notify.error(e, { title: 'Could not start the check', retry: canRetry(e) ? () => runAi.mutate() : undefined }),
  });

  const fixOne = useMutation({
    mutationFn: async (issue: Issue) => { await flush(); return studioApi.fix(session.id, issue.fix as Record<string, unknown>, issue.message); },
    onSuccess: (r) => { onContent(r.content, r.revision); },
    onError: (e, issue) => notify.error(e, { title: isConflict(e) ? 'The text has changed' : 'Could not apply the fix', retry: !isConflict(e) && canRetry(e) ? () => fixOne.mutate(issue) : undefined }),
  });
  const applyAll = useMutation({
    mutationFn: async () => { await flush(); return studioApi.applyAll(session.id); },
    onSuccess: (r) => {
      if (r.fixed) onContent(r.content, r.revision);
      setActiveId(null);
      const title = r.fixed ? `${plural(r.fixed, 'fix', 'fixes')} applied` : 'Nothing left to fix';
      const message = r.skipped ? `${plural(r.skipped, 'fix', 'fixes')} no longer fit the text and ${r.skipped === 1 ? 'was' : 'were'} skipped. Run the checks again.`
        : r.fixed ? 'One revision; take it back in Changes.' : undefined;
      if (r.fixed) notify.success(message ?? title, message ? { title, duration: 6000 } : undefined);
      else notify.info(message ?? title, message ? { title } : undefined);
    },
    onError: (e) => notify.error(e, { title: 'Could not apply the fixes', retry: canRetry(e) ? () => applyAll.mutate() : undefined }),
  });

  const aiResult = (aiMessage?.status === 'done' ? aiMessage : lastAi.data?.message) ?? null;
  const aiIssues = aiResult?.proposal?.issues ?? NO_ISSUES;
  const stale = aiMessage?.status === 'done' ? (aiMessage.proposal?.revision ?? 0) !== session.revision : !!lastAi.data?.stale;
  const issues = useMemo(() => [...(local.data?.issues ?? NO_ISSUES), ...(stale ? NO_ISSUES : aiIssues)], [local.data, aiIssues, stale]);
  useEffect(() => { onIssues(issues); }, [issues, onIssues]);

  const fixable = issues.filter((i) => i.fix).length;
  const goTo = (i: Issue) => { setActiveId(i.id); onGoTo(i); };
  const grouped = GROUPS.map((g) => ({ ...g, items: issues.filter((i) => g.test(i)) })).filter((g) => g.items.length);
  const must = issues.filter((i) => i.rule === 'placeholder').length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const failed = local.isError && !local.data;                              // the checks could not run: that is not "No issues"
  const checking = local.isLoading && !local.data;

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-[15px] font-semibold text-[#1f2933]">Checks</h3>
            <InfoTip label="About the checks" text="Run on every saved change, without AI: headings and numbering, spacing, repeated words, lists, tables, the sections the document type requires, placeholders, the entity name and logo. Click an item to see it in the document; a fix is one click." />
          </div>
          <p className="mt-0.5 text-ds-label text-ds-fg-muted" role="status">
            {checking ? 'Checking…' : failed ? 'Not checked' : issues.length === 0 ? <span className="inline-flex items-center gap-1 text-ds-success"><Check aria-hidden className="h-3.5 w-3.5" /> No issues</span>
              : [errors ? plural(errors, 'error') : '', plural(warnings, 'warning'), must ? plural(must, 'placeholder') : ''].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {must > 0 && <Button size="sm" onClick={onNextPlaceholder} title="Go to the next placeholder to fill in">Next placeholder</Button>}
          <Button size="sm" variant="primary" leftIcon={<Wand2 aria-hidden />} loading={applyAll.isPending} disabled={!fixable} onClick={() => applyAll.mutate()}
            title="Apply every fix listed here in one go, as one revision">Apply all fixes ({fixable})</Button>
        </div>
      </div>

      {failed && (
        <div className="mt-3 rounded-ds-card border border-ds-border bg-ds-surface">
          <ErrorState compact title="Couldn't run the checks" message={errorMessage(local.error)} onRetry={canRetry(local.error) ? () => { void local.refetch(); } : undefined} />
        </div>
      )}
      {checking && <div className="mt-3"><SkeletonRows rows={3} columns={1} label="Running the checks" /></div>}

      <div className="mt-3 rounded-ds-card border border-ds-border bg-ds-surface p-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ds-primary-text" aria-hidden />
          <p className="flex-1 text-ds-body text-ds-fg-body">Spelling, grammar and wording</p>
          <Button size="sm" variant="primary" leftIcon={<Sparkles aria-hidden />} loading={working || runAi.isPending} disabled={!aiConfigured} onClick={() => runAi.mutate()}
            aria-label={working ? undefined : 'Ask Comply Agent to check'} title={aiConfigured ? 'Comply Agent checks spelling, grammar and wording' : 'Comply Agent is not connected yet'}>
            {working ? aiMessage?.stage ?? 'Checking' : 'Check'}
          </Button>
        </div>
        {aiResult?.content && !working && <p className="mt-2 text-ds-label text-ds-fg-body">{aiResult.content}</p>}
        {stale && aiResult && !working && <p className="mt-1 text-ds-label text-ds-warning">Hidden: the document changed since this check</p>}
        {aiResult?.notes?.map((n, i) => <p key={i} className="mt-1 text-ds-label text-ds-warning">{n}</p>)}
      </div>

      {grouped.map((g) => (
        <section key={g.key} className="mt-4" aria-label={g.label}>
          <div className="mb-1.5 flex items-center gap-1">
            <h4 className="text-ds-label text-ds-fg-muted">{g.label} ({g.items.length})</h4>
            {g.note && <InfoTip label={`About ${g.label.toLowerCase()}`} text={g.note} />}
          </div>
          <ul className="space-y-1.5">
            {g.items.map((i) => <IssueRow key={i.id} issue={i} active={activeId === i.id} onGoTo={goTo} onFix={(x) => fixOne.mutate(x)} fixing={fixOne.isPending && fixOne.variables?.id === i.id} terse={g.terse} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
