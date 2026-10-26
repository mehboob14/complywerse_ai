'use client';

/**
 * Checks on the document. The ones that need no AI (headings and numbering, spacing, repeated words, lists, tables, the
 * sections the document type requires, placeholders still to fill in, the entity name and logo) run on every saved change.
 * Comply Agent's check proofreads spelling, grammar and wording. Clicking an item shows and highlights its place in the
 * document; a fix is one click, and "Apply all fixes" applies every fix offered (Comply Agent's suggestions and added sections
 * too) as one revision that History can undo.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleAlert, Info, Loader2, MapPin, Sparkles, Wand2 } from 'lucide-react';
import { isConflict, problemOf, studioApi, type Issue, type Message, type Session } from '@/lib/studio/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
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
  if (level === 'error') return <CircleAlert className="h-4 w-4 shrink-0 text-[#c53030]" aria-label="Error" />;
  if (level === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-[#c27803]" aria-label="Warning" />;
  return <Info className="h-4 w-4 shrink-0 text-[#2563eb]" aria-label="Note" />;
}

function IssueRow({ issue, active, onGoTo, onFix, fixing, terse }: { issue: Issue; active: boolean; onGoTo: (i: Issue) => void; onFix: (i: Issue) => void; fixing: boolean; terse?: boolean }) {
  const located = issue.block != null || !!issue.quote;
  return (
    <li className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${active ? 'border-[#f59e0b] bg-[#fffbeb] ring-1 ring-[#fcd34d]' : 'border-[#e1e6eb] bg-[#fff] hover:border-[#0f766e]'}`}>
      <button type="button" disabled={!located} onClick={() => onGoTo(issue)} aria-pressed={active} title={located ? 'Show and highlight it in the document' : undefined}
        className="flex min-w-0 flex-1 items-start gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ed4b0] disabled:cursor-default">
        <span className="mt-0.5"><Severity level={issue.severity} /></span>
        <span className="min-w-0 flex-1 text-[13px]">
          {!(terse && issue.quote) && <span className="block text-[#1f2933]">{issue.message}</span>}
          {issue.quote && <span className={terse ? 'block truncate text-[#1f2933]' : 'mt-0.5 block truncate text-xs italic text-[#586472]'} title={terse ? `${issue.message} ${issue.quote}` : issue.quote}>“{issue.quote}”</span>}
          {issue.suggestion && <span className="mt-0.5 block text-xs text-[#0a5a38]">Suggestion: {issue.suggestion}</span>}
        </span>
        {located && <MapPin className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-[#b45309]' : 'text-[#94a3b8]'}`} aria-hidden />}
      </button>
      {issue.fix && (
        <button type="button" disabled={fixing} onClick={() => onFix(issue)} title="Fix it" className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#e6f4f1] px-2 py-1 text-xs font-semibold text-[#0f766e] hover:bg-[#cfe9e4] disabled:opacity-50">
          {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Fix
        </button>
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
  const { toast } = useToast();
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
          if (m.status === 'error') toast({ title: 'The check did not finish', message: m.error ?? undefined, type: 'error' });
        }
      } catch { /* try again on the next tick */ }
    }, 1500);
    return () => clearInterval(t);
  }, [aiMessage, session.id, qc, toast]);

  const runAi = useMutation({
    mutationFn: async () => { await flush(); return studioApi.checks(session.id, true); },
    onSuccess: (r) => { if (r.ai_message) setAiMessage(r.ai_message); },
    onError: (e) => toast({ title: 'Could not start the check', message: problemOf(e), type: 'error' }),
  });

  const fixOne = useMutation({
    mutationFn: async (issue: Issue) => { await flush(); return studioApi.fix(session.id, issue.fix as Record<string, unknown>, issue.message); },
    onSuccess: (r) => { onContent(r.content, r.revision); },
    onError: (e) => toast({ title: isConflict(e) ? 'The text has changed' : 'Could not apply the fix', message: problemOf(e), type: 'error' }),
  });
  const applyAll = useMutation({
    mutationFn: async () => { await flush(); return studioApi.applyAll(session.id); },
    onSuccess: (r) => {
      if (r.fixed) onContent(r.content, r.revision);
      setActiveId(null);
      toast({
        title: r.fixed ? `${plural(r.fixed, 'fix', 'fixes')} applied` : 'Nothing left to fix',
        message: r.skipped ? `${plural(r.skipped, 'fix', 'fixes')} no longer fit the text and ${r.skipped === 1 ? 'was' : 'were'} skipped. Run the checks again.`
          : r.fixed ? 'One revision; take it back in Changes.' : undefined,
        type: r.fixed ? 'success' : 'info',
      });
    },
    onError: (e) => toast({ title: 'Could not apply the fixes', message: problemOf(e), type: 'error' }),
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

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-[15px] font-semibold text-[#1f2933]">Checks</h3>
            <InfoTip label="About the checks" text="Run on every saved change, without AI: headings and numbering, spacing, repeated words, lists, tables, the sections the document type requires, placeholders, the entity name and logo. Click an item to see it in the document; a fix is one click." />
          </div>
          <p className="mt-0.5 text-xs text-[#586472]" role="status">
            {local.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Checking" /> : issues.length === 0 ? <span className="inline-flex items-center gap-1 text-[#0a5a38]"><Check className="h-3.5 w-3.5" /> No issues</span>
              : [errors ? plural(errors, 'error') : '', plural(warnings, 'warning'), must ? plural(must, 'placeholder') : ''].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {must > 0 && <button type="button" onClick={onNextPlaceholder} className="rounded-md border border-[#e0c33a] bg-[#fff7c9] px-2 py-1 text-xs font-semibold text-[#6b5400] hover:bg-[#fff2a8]" title="Go to the next placeholder to fill in">Next placeholder</button>}
          <button type="button" disabled={!fixable || applyAll.isPending} onClick={() => applyAll.mutate()} title="Apply every fix listed here in one go, as one revision"
            className="inline-flex items-center gap-1 rounded-md bg-[#0f766e] px-2.5 py-1 text-xs font-semibold text-[#fff] hover:bg-[#115e59] disabled:opacity-50">
            {applyAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Apply all fixes ({fixable})
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-[#d5dbe1] bg-[#fff] p-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#0f766e]" aria-hidden />
          <p className="flex-1 text-[13px] text-[#26323d]">Spelling, grammar and wording</p>
          <button type="button" disabled={!aiConfigured || working || runAi.isPending} onClick={() => runAi.mutate()} aria-label={working ? undefined : 'Ask Comply Agent to check'}
            title={aiConfigured ? 'Comply Agent checks spelling, grammar and wording' : 'Comply Agent is not connected yet'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-xs font-semibold text-[#fff] hover:bg-[#115e59] disabled:opacity-50">
            {working || runAi.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {working ? aiMessage?.stage ?? 'Checking' : 'Check'}
          </button>
        </div>
        {aiResult?.content && !working && <p className="mt-2 text-xs text-[#3f4b58]">{aiResult.content}</p>}
        {stale && aiResult && !working && <p className="mt-1 text-xs text-[#8a6100]">Hidden: the document changed since this check</p>}
        {aiResult?.notes?.map((n, i) => <p key={i} className="mt-1 text-xs text-[#8a6100]">{n}</p>)}
      </div>

      {grouped.map((g) => (
        <section key={g.key} className="mt-4" aria-label={g.label}>
          <div className="mb-1.5 flex items-center gap-1">
            <h4 className="text-xs font-semibold text-[#586472]">{g.label} ({g.items.length})</h4>
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
