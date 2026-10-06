'use client';
// One identity in full: who it is, what access it holds and from where, what every rule found
// about it (failures first; a rule that could not judge says why), what the AI suggests, and
// the decision — chosen, justified and saved on purpose, with evidence if there is any.

import { useState } from 'react';
import { CheckCircle2, Info, Paperclip, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { errorText, useSetDecision, useUploadEvidence } from '../../api';
import { decisionClass, decisionLabel, riskClass } from '../../pipeline';
import type { AccessGrant, Decision, Outcome, ReviewItem, RuleResult } from '../../types';
import { Dialog } from '../../_components/Dialog';
import { FrameworkChips } from '../../_components/RuleResults';
import { Alert, Badge, Button, FOCUS, RadioCards, SeverityTag, inputClass } from '../../_components/ui';
import { KIND_LABEL } from './CertifyTab';

// ---- where a grant came from, in words -----------------------------------------------------
const SOURCE_LABEL: Record<string, string> = {
  digitalocean: 'DigitalOcean', okta: 'Okta', google: 'Google Workspace',
  ldap: 'Active Directory', sailpoint: 'SailPoint', entra_id: 'Microsoft Entra ID',
};
export function sourceName(source?: string | null): string {
  if (!source) return 'Granted in this platform';
  if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  const [kind, name] = source.includes(':') ? source.split(':') : ['', source];
  const pretty = name.replace(/_/g, ' ').replace(/\w/g, (c) => c.toUpperCase());
  return kind ? `${pretty} (${kind === 'iga' ? 'IGA' : 'App'})` : pretty;
}

function AccessHeld({ access, roles }: { access?: AccessGrant[]; roles: string[] }) {
  const grants = access?.length ? access : roles.map((name) => ({ name, source: null }));
  if (!grants.length) return <p className="text-sm text-slate-700">No access is recorded for this identity.</p>;
  const bySource = new Map<string, string[]>();
  grants.forEach((g) => bySource.set(sourceName(g.source), [...(bySource.get(sourceName(g.source)) ?? []), g.name]));
  return (
    <div className="space-y-2">
      {Array.from(bySource.entries()).map(([source, names]) => (
        <section key={source} aria-label={`Access granted by ${source}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{source}</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-900">
            {names.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---- rules ---------------------------------------------------------------------------------
const norm = (o: Outcome): Outcome => (o === 'error' ? 'not_run' : o);

function RuleList({ rules, meta }: { rules: RuleResult[]; meta: Map<string, RuleResult> }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {rules.map((r) => {
        const why = r.status === 'fail' ? r.detail : r.reason || r.detail;
        const refs = meta.get(r.id)?.frameworks;
        return (
          <li key={r.id} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-slate-900">{r.name}</span>
              <span className="font-mono text-xs text-slate-600">{r.id}</span>
              <SeverityTag severity={r.severity} />
            </div>
            {why && <p className="mt-0.5 text-sm text-slate-700">{why}</p>}
            {!!refs?.length && <div className="mt-1"><FrameworkChips refs={refs} total={meta.get(r.id)?.frameworks_total} max={2} /></div>}
          </li>
        );
      })}
    </ul>
  );
}

function RulesChecked({ rules, meta }: { rules: RuleResult[]; meta: Map<string, RuleResult> }) {
  const by = (s: Outcome) => rules.filter((r) => norm(r.status) === s).sort((a, b) => a.id.localeCompare(b.id));
  const failed = by('fail'); const notRun = by('not_run'); const passed = by('pass'); const na = by('not_applicable');
  const fold = (title: string, list: RuleResult[]) => list.length > 0 && (
    <details className="mt-3 rounded-lg border border-slate-200 bg-white">
      <summary className={clsx('cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-slate-900', FOCUS)}>{title} ({list.length})</summary>
      <div className="border-t border-slate-100 p-2"><RuleList rules={list} meta={meta} /></div>
    </details>
  );
  if (!rules.length) return <p className="text-sm text-slate-700">No rule has run on this identity yet.</p>;
  return (
    <div>
      <p className="text-sm text-slate-700">
        {failed.length} failed · {notRun.length} could not run · {passed.length} passed · {na.length} did not apply
      </p>
      {failed.length > 0 && (
        <div className="mt-2"><h4 className="mb-1 text-sm font-semibold text-rose-800">Failed</h4><RuleList rules={failed} meta={meta} /></div>
      )}
      {notRun.length > 0 && (
        <div className="mt-3"><h4 className="mb-1 text-sm font-semibold text-amber-900">Could not run</h4><RuleList rules={notRun} meta={meta} /></div>
      )}
      {fold('Passed', passed)}
      {fold('Did not apply', na)}
    </div>
  );
}

// ---- the drawer ----------------------------------------------------------------------------
const DECISIONS = [
  { value: 'approved', label: 'Approve', description: 'This access is appropriate.' },
  { value: 'revoke', label: 'Revoke', description: 'This access should be removed.' },
  { value: 'exception', label: 'Exception', description: 'Keep it, for a reason you record.' },
] as const;

const aiWord = (r?: string | null) => (r === 'revoke' ? 'Revoke' : r === 'approved' || r === 'approve' ? 'Approve' : r === 'exception' ? 'Exception' : null);

export function IdentityDrawer({ campaignId, item, results, readOnly, hasNext, onClose, onSaved }: {
  campaignId: number; item: ReviewItem; results: RuleResult[]; readOnly: boolean; hasNext: boolean;
  onClose: () => void; onSaved: (decision: Decision, next: boolean) => void;
}) {
  const setDecision = useSetDecision(campaignId);
  const upload = useUploadEvidence(campaignId);
  const [choice, setChoice] = useState<Decision>(item.decision);
  const [note, setNote] = useState(item.decision_comment ?? '');
  const name = item.display_name || item.email || 'Identity';
  const meta = new Map(results.map((r) => [r.id, r]));
  const kind = item.kind ?? 'person';
  const ai = aiWord(item.ai_recommendation);
  const save = (next: boolean) => setDecision.mutate(
    { itemId: item.id, decision: choice, note: note.trim() || undefined },
    { onSuccess: () => onSaved(choice, next) },
  );
  const fact = (label: string, value: string) => (
    <div><dt className="text-xs font-medium text-slate-600">{label}</dt><dd className="text-sm font-medium text-slate-900">{value}</dd></div>
  );
  const yesNo = (v: boolean | null | undefined, yes: string, no: string) => (v === null || v === undefined ? 'Not reported' : v ? yes : no);

  return (
    <Dialog open onClose={onClose} side width="max-w-xl" busy={setDecision.isPending} title={name}
      description={[item.email, KIND_LABEL[kind]].filter(Boolean).join(' · ')}
      footer={readOnly ? <Button onClick={onClose}>Close</Button> : (
        <>
          <Button variant="ghost" onClick={onClose} disabled={setDecision.isPending}>Cancel</Button>
          <Button variant={hasNext ? 'secondary' : 'primary'} loading={setDecision.isPending} disabled={choice === 'pending'} onClick={() => save(false)}>Save decision</Button>
          {hasNext && <Button variant="primary" loading={setDecision.isPending} disabled={choice === 'pending'} onClick={() => save(true)}>Save and open next</Button>}
        </>
      )}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx('inline-flex h-7 items-center rounded-md px-2 text-sm font-semibold tabular-nums', riskClass(item.risk_score))}>Risk {item.risk_score ?? 0}</span>
          {item.is_privileged && <Badge tone="amber">Privileged</Badge>}
          {item.is_terminated && <Badge tone="rose">Terminated</Badge>}
          {item.is_anomaly && <Badge tone="slate">Unusual</Badge>}
          <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', decisionClass[item.decision])}>{decisionLabel[item.decision]}</span>
        </div>
        {item.is_anomaly && item.anomaly_note && <p className="-mt-3 text-sm text-slate-700">{item.anomaly_note}</p>}

        <section aria-label="Details">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Details</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {fact('Department', item.department || '—')}
            {fact('Title', item.designation || '—')}
            {fact('Multi-factor sign-in', yesNo(item.mfa_enabled, 'Enabled', 'Not enabled'))}
            {fact('Account', yesNo(item.account_enabled, 'Active', 'Disabled'))}
            {fact('Last sign-in', item.last_sign_in ? new Date(item.last_sign_in).toLocaleDateString() : 'Not reported')}
            {fact('Left the organisation', item.termination_date ? new Date(item.termination_date).toLocaleDateString() : '—')}
          </dl>
        </section>

        <section aria-label="Access held">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Access held</h3>
          <AccessHeld access={item.access} roles={item.roles ?? []} />
        </section>

        <section aria-label="Rules checked">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Rules checked</h3>
          <RulesChecked rules={item.rules ?? []} meta={meta} />
        </section>

        <section aria-label="AI suggestion" className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            <Sparkles size={15} className="text-slate-600" aria-hidden /> AI suggestion
            {ai && <Badge tone="slate">Suggests: {ai}</Badge>}
          </h3>
          <p className="mt-1 text-sm text-slate-700">{item.ai_reason ?? 'No suggestion has been generated. Use “Ask AI for suggestions” on the Certify tab.'}</p>
          <p className="mt-1 text-xs text-slate-600">It is advice only. Nothing changes until you decide.</p>
        </section>

        <section aria-label="Your decision">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{readOnly ? 'Decision' : 'Your decision'}</h3>
          {readOnly ? (
            <div className="space-y-2 text-sm text-slate-800">
              <p><span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', decisionClass[item.decision])}>{decisionLabel[item.decision]}</span></p>
              <p>{item.decision_comment ? <>Justification: {item.decision_comment}</> : 'No justification was recorded.'}</p>
              <p className="flex items-center gap-1.5">{item.evidence_id ? <><CheckCircle2 size={15} className="text-emerald-700" aria-hidden /> Evidence is attached.</> : 'No evidence is attached.'}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <RadioCards legend="Decision" name={`decision-${item.id}`} columns={3} value={choice === 'pending' ? ('' as Decision) : choice}
                onChange={setChoice} options={DECISIONS.map((d) => ({ ...d }))} />
              {choice === 'revoke' && (
                <Alert tone="info">Recorded as an instruction to remove this access. Removing it in the source is a separate step.</Alert>
              )}
              <div>
                <label htmlFor={`note-${item.id}`} className="mb-1 block text-sm font-medium text-slate-800">Justification</label>
                <textarea id={`note-${item.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`note-hint-${item.id}`} className={inputClass} />
                <p id={`note-hint-${item.id}`} className="mt-1 text-xs text-slate-600">Optional. Recorded as audit evidence. Worth writing for a revoke or an exception.</p>
              </div>
              <div>
                <label className={clsx('inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-700 has-[:focus-visible]:ring-offset-2')}>
                  <Paperclip size={16} aria-hidden /> {item.evidence_id ? 'Replace evidence' : 'Attach evidence'}
                  <input type="file" className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ itemId: item.id, file: f }); e.target.value = ''; }} />
                </label>
                <p role="status" className="mt-1 text-xs text-slate-600">
                  {upload.isPending ? 'Uploading…' : upload.isSuccess ? 'Evidence uploaded.' : item.evidence_id ? 'Evidence is attached.' : 'Optional. A screenshot, an approval email, a ticket.'}
                </p>
                {upload.isError && <Alert tone="error" className="mt-2">{errorText(upload.error, 'The file could not be uploaded.')}</Alert>}
              </div>
              {setDecision.isError && <Alert tone="error">{errorText(setDecision.error, 'The decision could not be saved.')}</Alert>}
              {choice === 'pending' && <p className="text-xs text-slate-600">Choose a decision to enable Save.</p>}
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
