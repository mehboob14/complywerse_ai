'use client';
// Start an access review. One page, four plain questions — what to review, who to certify,
// which rules to run, and what to call it — with a summary that says exactly what will happen.
// (It used to be a pop-up: too long for one, and the rule choice needs room.)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { ShieldCheck } from 'lucide-react';
import { errorText, useConnectors, useCreateCampaign } from '../api';
import type { RuleSelection } from '../types';
import { RulePicker, selectionReady, useRulesFor } from '../_components/RulePicker';
import { Alert, ButtonLink, Button, Card, Field, RadioCards, inputClass } from '../_components/ui';
import { usePageTitle } from '../_components/usePageTitle';

const SCOPES = [
  { value: 'user_access', label: 'Everyone', description: 'All identities in scope.' },
  { value: 'privileged_access', label: 'Privileged only', description: 'Admins and holders of powerful access.' },
  { value: 'terminated_access', label: 'Leavers only', description: 'People with a termination date.' },
] as const;
const METHODS = [
  { value: 'random', label: 'Random', description: 'An unbiased sample.' },
  { value: 'risk_based', label: 'Risk-weighted', description: 'Favours identities with more risk.' },
  { value: 'full', label: 'Everyone in scope', description: 'No sampling.' },
] as const;
const crumbs = [
  { label: 'Compliance', href: '/compliance' },
  { label: 'Access reviews', href: '/compliance/access-reviews' },
  { label: 'New review', href: '/compliance/access-reviews/new' },
];
const month = () => new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

export default function NewReviewPage() {
  usePageTitle('New access review');
  const router = useRouter();
  const create = useCreateCampaign();
  const connectors = useConnectors();
  const sources = useMemo(() => connectors.data?.sources ?? [], [connectors.data]);

  const [source, setSource] = useState(useSearchParams().get('source') ?? '');   // ?source= preselects one (from Sources)
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);              // the person typed a name: stop suggesting one
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<string>('user_access');
  const [method, setMethod] = useState<string>('random');
  const [size, setSize] = useState(25);
  const [rules, setRules] = useState<RuleSelection>({ rule_scope: 'enabled' });
  const [errors, setErrors] = useState<{ name?: string; rules?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);

  const sourceLabel = sources.find((s) => s.key === source)?.label ?? null;
  const { rules: willRun } = useRulesFor(rules, source || null);
  const estate = willRun.filter((r) => r.kind === 'connector').length;

  // Suggest a name from what is being reviewed, until the person writes their own.
  useEffect(() => {
    if (!named) setName(`${sourceLabel ?? 'Access'} review — ${month()}`);
  }, [sourceLabel, named]);

  const inScope = source ? sources.find((s) => s.key === source)?.people ?? 0 : (connectors.data?.user_count ?? 0);
  const full = method === 'full';
  const sample = full ? inScope : Math.min(size, inScope || size);
  const ready = selectionReady(rules, willRun.length);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Give the review a name.';
    if (!ready) next.rules = rules.rule_scope === 'framework' && !rules.rule_framework ? 'Choose a framework.' : 'Choose at least one rule that can run.';
    setErrors(next);
    if (next.name) { nameRef.current?.focus(); return; }
    if (next.rules) return;
    create.mutate({
      name: name.trim(), description: description.trim() || undefined, review_type: scope, sampling_method: method,
      requested_sample_size: full ? Math.max(inScope, 1) : size, source: source || null, ...rules,
    }, { onSuccess: (c) => router.push(`/compliance/access-reviews/${c.id}`) });
  };

  const sourceOptions = useMemo(() => [
    { value: '', label: 'Every connected source', description: `${connectors.data?.user_count ?? 0} identities in total.` },
    ...sources.map((s) => ({ value: s.key, label: s.label, description: `${s.people ?? 0} identit${(s.people ?? 0) === 1 ? 'y' : 'ies'}` })),
  ], [sources, connectors.data]);

  return (
    <div className="space-y-5">
      <PageHeader title="New access review" subtitle="Decide what to review, who to certify and which rules to run. Nothing is read or changed until you start it."
        icon={ShieldCheck} breadcrumbs={crumbs} />

      {!connectors.isLoading && sources.length === 0 && (
        <Alert tone="warning" title="No source is connected yet"
          action={<ButtonLink href="/compliance/access-reviews/connect" size="sm" variant="secondary">Connect a source</ButtonLink>}>
          A review certifies the people and accounts a source reports. Connect one first.
        </Alert>
      )}

      <form onSubmit={submit} noValidate aria-label="New access review" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {(errors.name || errors.rules || create.isError) && (
            <Alert tone="error" title="This review cannot be created yet">
              <ul className="list-disc pl-5">
                {errors.name && <li>{errors.name}</li>}
                {errors.rules && <li>{errors.rules}</li>}
                {create.isError && <li>{errorText(create.error, 'The review could not be created.')}</li>}
              </ul>
            </Alert>
          )}

          <Card title="1. What to review" description="A review of one source tests that source's own rules as well as the people and accounts it reports.">
            <RadioCards legend="Source" name="source" columns={2} value={source} onChange={setSource} options={sourceOptions} />
          </Card>

          <Card title="2. Who to certify">
            <div className="space-y-4">
              <RadioCards legend="Scope" name="scope" columns={3} value={scope} onChange={setScope} options={[...SCOPES]} />
              <RadioCards legend="How to choose" name="method" columns={3} value={method} onChange={setMethod} options={[...METHODS]} />
              <div className="max-w-xs">
                <Field label="Sample size" hint={full ? 'Everyone in scope is certified, so there is no sample size.' : 'How many identities to draw and certify.'}>
                  {(aria) => (
                    <input {...aria} type="number" min={1} max={500} value={size} disabled={full}
                      onChange={(e) => setSize(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} className={inputClass} />
                  )}
                </Field>
              </div>
            </div>
          </Card>

          <Card title="3. Which rules to run">
            <RulePicker value={rules} onChange={setRules} source={source || null} sourceLabel={sourceLabel} />
          </Card>

          <Card title="4. Name it">
            <div className="space-y-4">
              <Field label="Review name" required error={errors.name}>
                {(aria) => (
                  <input {...aria} ref={nameRef} value={name} maxLength={255} className={inputClass}
                    onChange={(e) => { setName(e.target.value); setNamed(true); setErrors((x) => ({ ...x, name: undefined })); }} />
                )}
              </Field>
              <Field label="Description" hint="Optional. Shown on the report, for the auditor.">
                {(aria) => <textarea {...aria} value={description} rows={3} className={inputClass} onChange={(e) => setDescription(e.target.value)} />}
              </Field>
            </div>
          </Card>
        </div>

        <aside aria-label="What will happen" className="lg:sticky lg:top-4 lg:self-start">
          <Card title="What will happen" as="h2">
            <dl className="space-y-3 text-sm">
              <div><dt className="text-slate-600">Source</dt><dd className="font-medium text-slate-900">{sourceLabel ?? 'Every connected source'}</dd></div>
              <div><dt className="text-slate-600">Identities in scope</dt><dd className="font-medium tabular-nums text-slate-900">{inScope}</dd></div>
              <div><dt className="text-slate-600">Sample to certify</dt><dd className="font-medium tabular-nums text-slate-900">{full ? `All ${inScope}` : sample}</dd></div>
              <div>
                <dt className="text-slate-600">Rules</dt>
                <dd className="font-medium text-slate-900">
                  <span className="tabular-nums">{willRun.length}</span>
                  <span className="font-normal text-slate-700">{estate > 0 ? ` (${estate} test the estate, ${willRun.length - estate} test people)` : ''}</span>
                </dd>
              </div>
            </dl>
            <ol className="mt-4 list-decimal space-y-1 border-t border-slate-200 pl-5 pt-4 text-sm text-slate-700">
              <li>Collect the people and draw the sample.</li>
              <li>Run the rules and see each result.</li>
              <li>Decide on each identity.</li>
              <li>Seal the report as audit evidence.</li>
            </ol>
            <div className="mt-5 flex flex-col gap-2">
              <Button type="submit" variant="primary" loading={create.isPending} disabled={sources.length === 0}>Create review</Button>
              <ButtonLink href="/compliance/access-reviews" variant="ghost">Cancel</ButtonLink>
            </div>
          </Card>
        </aside>
      </form>
    </div>
  );
}
