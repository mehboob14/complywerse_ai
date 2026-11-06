'use client';

/**
 * The three stages of scoping an assessment: Scope (what is assessed), People (who runs it, who takes part), Plan (when and under which rules, or which
 * evidence). An application and a function are asked different things; the server's `scope` holds the keys of its own kind. Each form changes the
 * scope through `onScope` (the page saves as it goes); once the questions are open the subject, environment, level, period and exclusions are fixed
 * and only who takes part, the notes and the evidence plan can change.
 */
import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Checkbox, Combobox, FormField, IconButton, Notice, SectionCard, SegmentedControl, Select, Textarea, TextInput, type ListOption } from '@/components/ui/ds';
import { AssetPicker } from './AssetPicker';
import PeopleEditor, { usePeople } from './PeopleEditor';
import { ASSET_ROLE_LABEL, ASSET_ROLES_OF, ENVIRONMENTS, fromDateValue, LEVELS, splitList, TRIGGERS, toDateValue, unmet } from './scopingModel';
import type { AssetRef, AssetRole, Exclusion, ParticipantRole, Platform, Scope, ScopeView } from './scopingApi';

export interface StageProps {
  view: ScopeView;
  /** the scope as it is on the screen: the server's plus what has not been saved yet */
  scope: Scope;
  ownerId: number | null;
  dueDate: string | null;
  /** the field messages of the last save that was refused, by field */
  errors: Record<string, string>;
  onScope: (patch: Scope) => void;
  onOwner: (id: number) => void;
  onDue: (day: string | null) => void;
}

const GRID = 'grid grid-cols-1 gap-x-[16px] gap-y-[12px] sm:grid-cols-2';
const FACT = 'text-ds-body text-ds-fg-body';
const word = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—');

/** A list kept as one line of text ("Android, iOS") that stays as typed while it is edited. */
function ListField({ label, hint, value, onChange, disabled, placeholder }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <FormField label={label} optional hint={hint}>
      <TextInput value={text} disabled={disabled} placeholder={placeholder} onChange={(e) => { setText(e.target.value); onChange(splitList(e.target.value)); }} />
    </FormField>
  );
}

/** What is left out and why: a report must say what the assessment did not cover. */
function Exclusions({ value, onChange, disabled }: { value: Exclusion[]; onChange: (v: Exclusion[]) => void; disabled?: boolean }) {
  const [rows, setRows] = useState<Exclusion[]>(value);
  const commit = (next: Exclusion[]) => { setRows(next); onChange(next.filter((r) => r.what.trim())); };
  return (
    <div className="space-y-[8px]">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-[8px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <TextInput aria-label="What is left out" placeholder="What is left out" value={r.what} maxLength={200} disabled={disabled} onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)))} />
          <TextInput aria-label="Why" placeholder="Why" value={r.reason} maxLength={300} disabled={disabled} onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
          <IconButton label="Remove" disabled={disabled} onClick={() => commit(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden /></IconButton>
        </div>
      ))}
      <Button size="sm" leftIcon={<Plus aria-hidden />} disabled={disabled} onClick={() => commit([...rows, { what: '', reason: '' }])}>Add an exclusion</Button>
    </div>
  );
}

const date = (v: string | null | undefined) => toDateValue(v);

// ── Scope ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function ScopeStage(p: StageProps) {
  const { view, scope, errors, onScope } = p;
  const fixed = view.locked;
  const asset = view.scope_model === 'asset';
  const refs = scope.assets ?? [];
  const setRole = (assetId: number, role: AssetRole | '') => {
    const rest = refs.filter((r) => r.asset_id !== assetId);
    onScope({ assets: role ? [...rest, { asset_id: assetId, role, reason: refs.find((r) => r.asset_id === assetId)?.reason ?? '' }] : rest });
  };

  if (asset) {
    const a = view.primary_asset;
    return (
      <div className="space-y-[16px]">
        <SectionCard id="application" title="Application" meta={a?.name} info="From the asset library as it is today. When the assessment starts these facts are kept as they were.">
          {a ? (
            <dl className="grid grid-cols-1 gap-x-[16px] gap-y-[8px] sm:grid-cols-3">
              {([['Type', word(a.asset_type)], ['Criticality', word(a.criticality)], ['Environment in the library', word(a.environment)], ['Owner', a.owner ?? '—'], ['Department', a.department ?? '—'],
                ['Data classification', word(a.data_classification)], ['Reachable from the internet', a.internet_facing ? 'Yes' : 'No']] as const).map(([k, v]) => (
                <div key={k}><dt className="text-ds-label text-ds-fg-muted">{k}</dt><dd className={FACT}>{v}</dd></div>
              ))}
            </dl>
          ) : <p className="text-ds-body text-ds-fg-muted">The application is not in the library any more.</p>}
        </SectionCard>

        <SectionCard id="related" title="Related assets" info="Connected in the asset library. None is in scope unless you say so: an API behind a web application is assessed on its own terms.">
          {view.related_assets.length === 0 ? <p className="text-ds-body text-ds-fg-muted">The library connects no other asset to this one.</p> : (
            <ul className="space-y-[8px]">
              {view.related_assets.map((r) => (
                <li key={r.asset_id} className="flex flex-wrap items-center gap-[8px]">
                  <span className="min-w-0 flex-1 text-ds-body text-ds-fg">{r.name}<span className="text-ds-fg-muted"> · {word(r.asset_type)} · {r.relationship.replace(/_/g, ' ')} ({r.direction === 'outgoing' ? 'this depends on it' : 'it reaches this'})</span></span>
                  <Select aria-label={`${r.name}: its part in this assessment`} value={refs.find((x) => x.asset_id === r.asset_id)?.role ?? ''} disabled={fixed} onChange={(e) => setRole(r.asset_id, e.target.value as AssetRole | '')} className="w-[13rem]">
                    <option value="">Not in scope</option>
                    {ASSET_ROLES_OF.asset.map((role) => <option key={role} value={role}>{ASSET_ROLE_LABEL[role]}</option>)}
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard id="verified" title="What is verified" info="A report must say exactly what was assessed: the environment, the build and what was left out.">
          <div className={GRID}>
            <FormField label="Environment" required error={errors.environment}>
              <Select value={scope.environment ?? ''} disabled={fixed} onChange={(e) => onScope({ environment: (e.target.value || null) as Scope['environment'] })}>
                <option value="">Choose</option>
                {ENVIRONMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormField>
            <FormField label="Version or build" required error={errors.version} hint="For example 6.2 or build 4812.">
              <TextInput value={scope.version ?? ''} disabled={fixed} maxLength={100} onChange={(e) => onScope({ version: e.target.value })} />
            </FormField>
          </div>
          {view.assessment_format === 'asvs_checklist' && (
            <div className="mt-[12px] space-y-[8px]">
              <FormField label="ASVS level" required error={errors.level} hint={LEVELS.find(([n]) => n === scope.level)?.[2] ?? 'Choose by your own risk analysis of the application. Requirements above the level are marked not applicable.'}>
                <SegmentedControl label="ASVS level" name="asvs-level" value={scope.level ? String(scope.level) : ''} disabled={fixed}
                  onChange={(v) => onScope({ level: v ? Number(v) : null })} options={LEVELS.map(([n, l]) => ({ value: String(n), label: l }))} />
              </FormField>
              <FormField label="Why this level" optional>
                <Textarea rows={2} value={scope.level_reason ?? ''} disabled={fixed} maxLength={500} onChange={(e) => onScope({ level_reason: e.target.value })} />
              </FormField>
            </div>
          )}
          {view.assessment_format === 'mobile_app_security' && (
            <FormField label="Platforms" required error={errors.platforms} className="mt-[12px]" hint="Requirements of a platform you leave out are marked not applicable.">
              <div className="flex flex-wrap gap-[16px]">
                {([['android', 'Android'], ['ios', 'iOS']] as const).map(([v, l]) => (
                  <Checkbox key={v} label={l} disabled={fixed} checked={(scope.platforms ?? []).includes(v as Platform)}
                    onChange={(e) => onScope({ platforms: e.target.checked ? [...(scope.platforms ?? []), v as Platform] : (scope.platforms ?? []).filter((x) => x !== v) })} />
                ))}
              </div>
            </FormField>
          )}
          <div className="mt-[12px] space-y-[12px]">
            <ListField label="Roles tested" hint="The user roles tested with supplied credentials, separated by commas." value={scope.test_roles ?? []} disabled={fixed} onChange={(v) => onScope({ test_roles: v })} placeholder="Customer, Administrator" />
            <FormField label="Left out" optional hint="What this assessment does not cover, and why.">
              <Exclusions value={scope.exclusions ?? []} disabled={fixed} onChange={(v) => onScope({ exclusions: v })} />
            </FormField>
          </div>
        </SectionCard>
      </div>
    );
  }

  const supporting = refs.filter((r) => r.role !== 'primary');
  return (
    <div className="space-y-[16px]">
      <SectionCard id="function" title="Function or process" info="What is evaluated is the way the function works, not a server. The scope is fixed before the questions open because it decides who has to take part.">
        <div className={GRID}>
          <FormField label="Function or process" required error={errors.function} className="sm:col-span-2"><TextInput value={scope.function ?? ''} disabled={fixed} maxLength={200} onChange={(e) => onScope({ function: e.target.value })} /></FormField>
          <FormField label="Organisation" required error={errors.organisation} hint="This or the business unit."><TextInput value={scope.organisation ?? ''} disabled={fixed} maxLength={200} onChange={(e) => onScope({ organisation: e.target.value })} /></FormField>
          <FormField label="Business unit" optional><TextInput value={scope.business_unit ?? ''} disabled={fixed} maxLength={200} onChange={(e) => onScope({ business_unit: e.target.value })} /></FormField>
          <FormField label="Legal entity" optional><TextInput value={scope.legal_entity ?? ''} disabled={fixed} maxLength={200} onChange={(e) => onScope({ legal_entity: e.target.value })} /></FormField>
          <div />
          <FormField label="Period starts" required error={errors.period_start}><TextInput type="date" value={date(scope.period_start)} disabled={fixed} onChange={(e) => onScope({ period_start: fromDateValue(e.target.value) })} /></FormField>
          <FormField label="Period ends" required error={errors.period_end} hint="The period whose operation is evaluated."><TextInput type="date" value={date(scope.period_end)} disabled={fixed} onChange={(e) => onScope({ period_end: fromDateValue(e.target.value) })} /></FormField>
        </div>
        <div className="mt-[12px] space-y-[12px]">
          <ListField label="Sites or jurisdictions" value={scope.geography ?? []} disabled={fixed} onChange={(v) => onScope({ geography: v })} placeholder="Pakistan, UAE" hint="Separated by commas." />
          <ListField label="Services covered" value={scope.services ?? []} disabled={fixed} onChange={(v) => onScope({ services: v })} placeholder="24x7 monitoring, Incident response" hint="Separated by commas." />
          <FormField label="Left out" optional hint="What this assessment does not cover, and why."><Exclusions value={scope.exclusions ?? []} disabled={fixed} onChange={(v) => onScope({ exclusions: v })} /></FormField>
        </div>
      </SectionCard>

      <SectionCard id="supporting" title="Supporting assets" meta={supporting.length ? `${supporting.length} listed` : undefined}
        info="The tools and services the function relies on. They give the evidence its context; they are not assessed or scored.">
        {supporting.length > 0 && (
          <ul className="mb-[12px] space-y-[8px]">
            {supporting.map((r) => (
              <li key={r.asset_id} className="flex flex-wrap items-center gap-[8px]">
                <span className="min-w-0 flex-1 text-ds-body text-ds-fg">{view.facts[String(r.asset_id)]?.name ?? `Asset ${r.asset_id}`}<span className="text-ds-fg-muted"> · {word(view.facts[String(r.asset_id)]?.asset_type)}</span></span>
                <Select aria-label="Its part in this assessment" value={r.role} disabled={fixed} onChange={(e) => setRole(r.asset_id, e.target.value as AssetRole)} className="w-[13rem]">
                  {ASSET_ROLES_OF.process.map((role) => <option key={role} value={role}>{ASSET_ROLE_LABEL[role]}</option>)}
                </Select>
                <IconButton label="Remove" disabled={fixed} onClick={() => setRole(r.asset_id, '')}><X aria-hidden /></IconButton>
              </li>
            ))}
          </ul>
        )}
        {!fixed && <AssetPicker exclude={refs.map((r) => r.asset_id)} label="Search the asset library" onPick={(a) => onScope({ assets: [...refs, { asset_id: a.id, role: 'supporting', reason: '' } as AssetRef] })} />}
        {fixed && supporting.length === 0 && <p className="text-ds-body text-ds-fg-muted">No supporting asset was listed.</p>}
      </SectionCard>
    </div>
  );
}

// ── People ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function PeopleStage(p: StageProps) {
  const { view, scope, onScope, onOwner, onDue, errors } = p;
  const { personOptions } = usePeople();
  const model = view.scope_model ?? 'asset';
  const { required, advice } = unmet(view.readiness);
  const roleOfCheck: Record<string, ParticipantRole> = { application_owner: 'owner', process_owner: 'owner', assessor: 'assessor', reviewer: 'reviewer', sponsor: 'sponsor', contributors: 'contributor' };
  const missing = [...required, ...advice].map((c) => roleOfCheck[c.key]).filter(Boolean) as ParticipantRole[];
  const options: ListOption[] = personOptions;
  return (
    <div className="space-y-[16px]">
      <SectionCard id="owner" title="Who runs it" info="The assessment owner is accountable for running the assessment, not for the application or the function that is assessed.">
        <div className={GRID}>
          <FormField label="Assessment owner" required error={errors.owner_id}>
            <Combobox label="Assessment owner" options={options} value={p.ownerId ? String(p.ownerId) : null} onChange={(v) => { if (v) onOwner(Number(v)); }} placeholder="Choose a person" />
          </FormField>
          <FormField label="Target completion" optional><TextInput type="date" value={date(p.dueDate)} onChange={(e) => onDue(fromDateValue(e.target.value))} /></FormField>
        </div>
      </SectionCard>
      <SectionCard id="participants" title="Who takes part" meta={`${(scope.participants ?? []).length} named`}
        info={model === 'process' ? 'A function is answered by several people: its owner, the teams and providers that operate it, and a reviewer from outside who challenges the scores. Give someone domains to assign them those questions.' : 'The owner of the application, who verifies it, and who reviews the conclusions. Assessors should be independent of the application\'s team.'}>
        <PeopleEditor key={view.id} value={scope.participants ?? []} model={model} domains={view.domains} missingRoles={missing} onChange={(v) => onScope({ participants: v })} />
        {errors.participants && <p className="mt-[8px] text-ds-body text-ds-danger" role="alert">{errors.participants}</p>}
      </SectionCard>
    </div>
  );
}

// ── Plan ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function PlanStage(p: StageProps) {
  const { view, scope, errors, onScope } = p;
  const fixed = view.locked;
  const asset = view.scope_model === 'asset';
  const roe = scope.rules_of_engagement ?? { approved_by: '', approved_on: null, notes: '' };
  const risky = asset && (scope.environment === 'production' || !!scope.intrusive);
  const plan = scope.evidence_plan ?? { deadline: null, interviews: '', records: '', sampling: '' };
  return (
    <div className="space-y-[16px]">
      {asset ? (
        <>
          <SectionCard id="window" title="When">
            <div className={GRID}>
              <FormField label="Test window starts" optional error={errors.window_start}><TextInput type="date" value={date(scope.window_start)} disabled={fixed} onChange={(e) => onScope({ window_start: fromDateValue(e.target.value) })} /></FormField>
              <FormField label="Test window ends" optional error={errors.window_end}><TextInput type="date" value={date(scope.window_end)} disabled={fixed} onChange={(e) => onScope({ window_end: fromDateValue(e.target.value) })} /></FormField>
            </div>
            <Checkbox className="mt-[12px]" label="Includes intrusive tests" checked={!!scope.intrusive} disabled={fixed} onChange={(e) => onScope({ intrusive: e.target.checked })} />
          </SectionCard>
          <SectionCard id="rules" title="Rules of engagement" info="Who authorised the testing, and under which rules: the window, the contacts, how data is handled and what to do on finding a compromise.">
            {risky && <Notice tone="warning" title="Needed before the questions open" className="mb-[12px]">Testing in production, or any intrusive test, needs approved rules of engagement.</Notice>}
            <div className={GRID}>
              <FormField label="Approved by" required={risky}><TextInput value={roe.approved_by} disabled={fixed} maxLength={200} onChange={(e) => onScope({ rules_of_engagement: { ...roe, approved_by: e.target.value } })} /></FormField>
              <FormField label="Approved on" required={risky}><TextInput type="date" value={date(roe.approved_on)} disabled={fixed} onChange={(e) => onScope({ rules_of_engagement: { ...roe, approved_on: fromDateValue(e.target.value) } })} /></FormField>
              <FormField label="Notes" optional className="sm:col-span-2" hint="The contacts, the source addresses of the tests, the data handling rules."><Textarea rows={3} value={roe.notes} disabled={fixed} maxLength={500} onChange={(e) => onScope({ rules_of_engagement: { ...roe, notes: e.target.value } })} /></FormField>
            </div>
          </SectionCard>
        </>
      ) : (
        <SectionCard id="evidence" title="Evidence" info="Statements are rated on evidence: documents, records and what people say. Decide now what will be asked for and how it will be sampled.">
          <div className={GRID}>
            <FormField label="Evidence due by" optional><TextInput type="date" value={date(plan.deadline)} onChange={(e) => onScope({ evidence_plan: { ...plan, deadline: fromDateValue(e.target.value) } })} /></FormField>
            <div />
            <FormField label="Interviews and walkthroughs" optional><Textarea rows={2} value={plan.interviews} maxLength={500} onChange={(e) => onScope({ evidence_plan: { ...plan, interviews: e.target.value } })} /></FormField>
            <FormField label="Records to sample" optional hint="For example incident tickets of the period."><Textarea rows={2} value={plan.records} maxLength={500} onChange={(e) => onScope({ evidence_plan: { ...plan, records: e.target.value } })} /></FormField>
            <FormField label="How they are sampled" optional className="sm:col-span-2"><Textarea rows={2} value={plan.sampling} maxLength={500} onChange={(e) => onScope({ evidence_plan: { ...plan, sampling: e.target.value } })} /></FormField>
          </div>
        </SectionCard>
      )}
      <SectionCard id="why" title="Why now">
        <div className={GRID}>
          <FormField label="What triggered it" optional>
            <Select value={scope.trigger ?? ''} disabled={fixed} onChange={(e) => onScope({ trigger: e.target.value || null })}>
              <option value="">Not recorded</option>
              {TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormField>
          <div />
          <FormField label="Notes" optional className="sm:col-span-2"><Textarea rows={3} value={scope.notes ?? ''} maxLength={2000} onChange={(e) => onScope({ notes: e.target.value })} /></FormField>
        </div>
      </SectionCard>
    </div>
  );
}
