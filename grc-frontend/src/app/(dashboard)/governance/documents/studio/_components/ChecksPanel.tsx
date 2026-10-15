'use client';

/**
 * Checks on the document. The ones that need no AI (headings and numbering, spacing, repeated words, lists, tables, the
 * sections the document type requires, placeholders still to fill in, the entity name and logo) run on every saved change.
 * The AI check proofreads spelling, grammar and wording, and judges each required item. A simple fix is one click; every
 * issue can be shown in the document.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, CircleAlert, CircleDashed, Info, Loader2, MapPin, Sparkles, Wand2, XCircle } from 'lucide-react';
import { isConflict, problemOf, studioApi, type Issue, type Message, type Session, type Verdict } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import { plural } from '@/lib/studio/text';

const GROUPS: { key: string; label: string; test: (i: Issue) => boolean }[] = [
  { key: 'fill', label: 'Still to fill in', test: (i) => i.rule === 'placeholder' },
  { key: 'language', label: 'Spelling, grammar and wording', test: (i) => ['spelling', 'grammar', 'style', 'consistency'].includes(i.kind) },
  { key: 'format', label: 'Formatting', test: (i) => i.kind === 'format' },
  { key: 'structure', label: 'Structure', test: (i) => i.kind === 'structure' },
  { key: 'entity', label: 'Entity name and logo', test: (i) => i.kind === 'entity' || i.kind === 'logo' },
  { key: 'sign', label: 'Signature lines (filled in when it is signed)', test: (i) => i.rule === 'placeholder_signature' },
];

const SIMPLE = ['replace', 'set_level', 'normalize_space', 'strip_trailing_punct'];

// stable empties: a new [] on every render would re-run the effects that depend on them
const NO_ISSUES: Issue[] = [];
const NO_VERDICTS: Verdict[] = [];

function Severity({ level }: { level: Issue['severity'] }) {
  if (level === 'error') return <CircleAlert className="h-4 w-4 shrink-0 text-[#c53030]" aria-label="Error" />;
  if (level === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-[#c27803]" aria-label="Warning" />;
  return <Info className="h-4 w-4 shrink-0 text-[#2563eb]" aria-label="Note" />;
}

function IssueRow({ issue, onGoTo, onFix, fixing }: { issue: Issue; onGoTo: (i: Issue) => void; onFix: (i: Issue) => void; fixing: boolean }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-2">
      <span className="mt-0.5"><Severity level={issue.severity} /></span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="text-[#1f2933]">{issue.message}</p>
        {issue.quote && <p className="mt-0.5 truncate text-xs italic text-[#586472]" title={issue.quote}>“{issue.quote}”</p>}
        {issue.suggestion && <p className="mt-0.5 text-xs text-[#0a5a38]">Suggestion: {issue.suggestion}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {(issue.block != null || issue.quote) && (
          <button type="button" onClick={() => onGoTo(issue)} title="Show it in the document" aria-label="Show it in the document" className="rounded p-1.5 text-[#3f4b58] hover:bg-[#eef1f4]"><MapPin className="h-4 w-4" /></button>
        )}
        {issue.fix && (
          <button type="button" disabled={fixing} onClick={() => onFix(issue)} title="Fix it" className="inline-flex items-center gap-1 rounded-md bg-[#e6f4f1] px-2 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-[#cfe9e4] disabled:opacity-50">
            {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Fix
          </button>
        )}
      </div>
    </li>
  );
}

function VerdictRow({ v, onGoTo }: { v: Verdict; onGoTo: (block: number) => void }) {
  const icon = v.status === 'met' ? <CheckCircle2 className="h-4 w-4 text-[#16794a]" aria-label="Met" /> : v.status === 'partly' ? <CircleDashed className="h-4 w-4 text-[#c27803]" aria-label="Partly met" /> : <XCircle className="h-4 w-4 text-[#c53030]" aria-label="Not met" />;
  return (
    <li className="flex items-start gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-2 text-[13px]">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[#1f2933]">{v.requirement}</p>
        {v.evidence && <p className="mt-0.5 text-xs text-[#586472]">{v.evidence}</p>}
      </div>
      {v.block != null && v.block >= 0 && <button type="button" onClick={() => onGoTo(v.block as number)} aria-label="Show it in the document" className="rounded p-1.5 text-[#3f4b58] hover:bg-[#eef1f4]"><MapPin className="h-4 w-4" /></button>}
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
  onGoToBlock: (block: number) => void;
  onIssues: (issues: Issue[]) => void;
  onNextPlaceholder: () => void;
}

export default function ChecksPanel({ session, aiConfigured, flush, onContent, onGoTo, onGoToBlock, onIssues, onNextPlaceholder }: ChecksPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [aiMessage, setAiMessage] = useState<Message | null>(null);

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
          if (m.status === 'error') toast({ title: 'The AI check did not finish', message: m.error ?? undefined, type: 'error' });
        }
      } catch { /* try again on the next tick */ }
    }, 1500);
    return () => clearInterval(t);
  }, [aiMessage, session.id, qc, toast]);

  const runAi = useMutation({
    mutationFn: async () => { await flush(); return studioApi.checks(session.id, true); },
    onSuccess: (r) => { if (r.ai_message) setAiMessage(r.ai_message); },
    onError: (e) => toast({ title: 'The AI check could not start', message: problemOf(e), type: 'error' }),
  });

  const fixOne = useMutation({
    mutationFn: async (issue: Issue) => { await flush(); return studioApi.fix(session.id, issue.fix as Record<string, unknown>, issue.message); },
    onSuccess: (r) => { onContent(r.content, r.revision); },
    onError: (e) => toast({ title: isConflict(e) ? 'The text has changed' : 'Could not apply the fix', message: problemOf(e), type: 'error' }),
  });
  const fixAll = useMutation({
    mutationFn: async () => { await flush(); return studioApi.fixAll(session.id); },
    onSuccess: (r) => { if (r.fixed) onContent(r.content, r.revision); toast({ title: r.fixed ? `${plural(r.fixed, 'fix', 'fixes')} applied` : 'Nothing simple left to fix', type: r.fixed ? 'success' : 'info' }); },
    onError: (e) => toast({ title: 'Could not apply the fixes', message: problemOf(e), type: 'error' }),
  });

  const aiResult = (aiMessage?.status === 'done' ? aiMessage : lastAi.data?.message) ?? null;
  const aiIssues = aiResult?.proposal?.issues ?? NO_ISSUES;
  const verdicts = aiResult?.proposal?.requirements ?? NO_VERDICTS;
  const stale = aiMessage?.status === 'done' ? (aiMessage.proposal?.revision ?? 0) !== session.revision : !!lastAi.data?.stale;
  const issues = useMemo(() => [...(local.data?.issues ?? NO_ISSUES), ...(stale ? NO_ISSUES : aiIssues)], [local.data, aiIssues, stale]);
  useEffect(() => { onIssues(issues); }, [issues, onIssues]);

  const simple = issues.filter((i) => i.fix && SIMPLE.includes(String(i.fix.type)) && !i.id.startsWith('ai:')).length;
  const grouped = GROUPS.map((g) => ({ ...g, items: issues.filter((i) => g.test(i)) })).filter((g) => g.items.length);
  const must = issues.filter((i) => i.rule === 'placeholder').length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#1f2933]">Checks</h3>
          <p className="mt-0.5 text-xs text-[#586472]" role="status">
            {local.isLoading ? 'Checking…' : issues.length === 0 ? <span className="inline-flex items-center gap-1 text-[#0a5a38]"><Check className="h-3.5 w-3.5" /> Nothing to report.</span>
              : `${errors ? `${plural(errors, 'error')}, ` : ''}${plural(warnings, 'warning')}${must ? ` · ${plural(must, 'placeholder')} to fill in` : ''}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {must > 0 && <button type="button" onClick={onNextPlaceholder} className="rounded-md border border-[#e0c33a] bg-[#fff7c9] px-2 py-1 text-xs font-semibold text-[#6b5400] hover:bg-[#fff2a8]">Next placeholder</button>}
          <button type="button" disabled={!simple || fixAll.isPending} onClick={() => fixAll.mutate()} className="inline-flex items-center gap-1 rounded-md bg-[#e6f4f1] px-2 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-[#cfe9e4] disabled:opacity-50">
            {fixAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Fix all simple ({simple})
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-[#d5dbe1] bg-[#f8fafb] p-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#0f766e]" />
          <p className="flex-1 text-xs text-[#3f4b58]">AI check: spelling, grammar, wording, and whether each required item is met.</p>
          <button type="button" disabled={!aiConfigured || working || runAi.isPending} onClick={() => runAi.mutate()} title={aiConfigured ? undefined : 'The AI is not connected yet'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
            {working || runAi.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {working ? aiMessage?.stage ?? 'Checking' : 'Run the AI check'}
          </button>
        </div>
        {aiResult?.content && !working && <p className="mt-2 text-xs text-[#3f4b58]">{aiResult.content}</p>}
        {stale && aiResult && !working && <p className="mt-1 text-[11px] text-[#8a6100]">The document changed since this check, so its findings are hidden. Run it again.</p>}
        {aiResult?.notes?.map((n, i) => <p key={i} className="mt-1 text-[11px] text-[#8a6100]">{n}</p>)}
      </div>

      {verdicts.length > 0 && (
        <section className="mt-4" aria-label="Required items">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#586472]">Required items</h4>
          <ul className="space-y-1.5">{verdicts.map((v, i) => <VerdictRow key={i} v={v} onGoTo={onGoToBlock} />)}</ul>
        </section>
      )}

      {grouped.map((g) => (
        <section key={g.key} className="mt-4" aria-label={g.label}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#586472]">{g.label} ({g.items.length})</h4>
          <ul className="space-y-1.5">
            {g.items.map((i) => <IssueRow key={i.id} issue={i} onGoTo={onGoTo} onFix={(x) => fixOne.mutate(x)} fixing={fixOne.isPending && fixOne.variables?.id === i.id} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
