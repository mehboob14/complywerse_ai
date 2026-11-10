'use client';

// The tiering factors and the evidence types, built-in and your own. Built-in ones can be renamed (evidence) or hidden (evidence) but not deleted; your own can be added, renamed and taken out.
// Something a question still uses cannot be taken out until the question changes. Rebuilt on the kit's tokens and controls (vendor-insights-setup); the props are the ones the page passed before.
import { useState } from 'react';
import { clsx } from 'clsx';
import { Plus, Trash2, Undo2 } from 'lucide-react';
import { Button, Checkbox, IconButton, TextInput } from '@/components/ui/ds';
import { newKey } from './_Questions';
import { Unit, inputCls } from './_ui';
import { activeEvidence, type EvidenceDraft, type Named } from './settingsModel';

export { activeEvidence };
export type { EvidenceDraft, Named };

const NOTE = 'text-ds-label text-ds-fg-muted';

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (label: string) => void }) {
  const [text, setText] = useState('');
  const add = () => { if (text.trim()) { onAdd(text.trim()); setText(''); } };
  return (
    <div className="mt-[8px] flex items-center gap-[8px]">
      <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="flex-1"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <Button onClick={add} disabled={!text.trim()} leftIcon={<Plus aria-hidden />}>Add</Button>
    </div>
  );
}

function Removed({ items, noun, onRestore, canEdit }: { items: Named[]; noun: string; onRestore: (key: string) => void; canEdit: boolean }) {
  if (!items.length) return null;
  return (
    <details className="mt-[8px]">
      <summary className="min-h-ds-control cursor-pointer py-[6px] text-ds-body text-ds-fg-muted">Taken out ({items.length}); {noun} already recorded against them are kept</summary>
      <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
        {items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-[8px] text-ds-body text-ds-fg-body">
            <span className="min-w-0 break-words">{i.label}</span>
            {canEdit && <Button size="sm" variant="ghost" leftIcon={<Undo2 aria-hidden />} onClick={() => onRestore(i.key)}>Put back</Button>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function FactorsEditor({ builtinLabels, weights, custom, usedBy, canEdit, onWeights, onFactors }: {
  builtinLabels: Record<string, string>; weights: Record<string, number>; custom: Named[]; usedBy: Record<string, string[]>;
  canEdit: boolean; onWeights: (w: Record<string, number>) => void; onFactors: (f: Named[], w: Record<string, number>) => void;
}) {
  const rows = [
    ...Object.entries(builtinLabels).map(([key, label]) => ({ key, label, builtin: true })),
    ...custom.filter((f) => !f.archived).map((f) => ({ key: f.key, label: f.label, builtin: false })),
  ];
  const total = rows.reduce((n, r) => n + (Number(weights[r.key]) || 0), 0);
  const rename = (key: string, label: string) => onFactors(custom.map((f) => (f.key === key ? { ...f, label } : f)), weights);
  const remove = (key: string) => {
    const w = { ...weights };
    delete w[key];
    onFactors(custom.map((f) => (f.key === key ? { ...f, archived: true } : f)), w);
  };
  const restore = (key: string) => onFactors(custom.map((f) => (f.key === key ? { ...f, archived: false } : f)), { ...weights, [key]: 0 });
  const add = (label: string) => {
    const key = newKey(label, [...Object.keys(builtinLabels), ...custom.map((f) => f.key)]);
    onFactors([...custom, { key, label }], { ...weights, [key]: 0 });
  };
  return (
    <div>
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] py-[6px]">
          {r.builtin ? (
            <label htmlFor={`w-${r.key}`} className="min-w-0 flex-1 basis-[10rem] text-ds-body text-ds-fg">{r.label}</label>
          ) : (
            <span className="flex min-w-0 flex-1 basis-[10rem] items-center gap-[6px]">
              <TextInput value={r.label} disabled={!canEdit} onChange={(e) => rename(r.key, e.target.value)} aria-label="Factor name" className="max-w-xs" />
              {canEdit && (
                <IconButton label={usedBy[r.key]?.length ? `Cannot take out ${r.label}: a question uses it` : `Take out ${r.label}`} disabled={!!usedBy[r.key]?.length} onClick={() => remove(r.key)}>
                  <Trash2 aria-hidden />
                </IconButton>
              )}
            </span>
          )}
          <span className="flex items-center gap-[8px]">
            <span className="hidden h-[6px] w-[112px] overflow-hidden rounded-full bg-ds-border sm:block" aria-hidden>
              <span className="block h-full rounded-full bg-ds-primary" style={{ width: `${total ? ((weights[r.key] || 0) / total) * 100 : 0}%` }} />
            </span>
            <input id={`w-${r.key}`} type="number" min={0} max={100} className={inputCls} disabled={!canEdit} value={weights[r.key] ?? 0}
              aria-label={`Weight of ${r.label}`} onChange={(e) => onWeights({ ...weights, [r.key]: Number(e.target.value) })} />
            <Unit>%</Unit>
          </span>
          {!r.builtin && usedBy[r.key]?.length ? (
            <p className={clsx('w-full', NOTE)}>Fed by: {usedBy[r.key].join('; ')}</p>
          ) : !r.builtin ? (
            <p className="w-full text-ds-label text-ds-warning">No question feeds it yet; give one a score for it under Onboarding questions.</p>
          ) : null}
        </div>
      ))}
      <p className={clsx('mt-[8px] text-right text-ds-body', Math.round(total) === 100 ? 'text-ds-success' : 'text-ds-fg-muted')}>
        Total {Math.round(total)}%{Math.round(total) !== 100 && ', scaled to 100% when saved'}
      </p>
      {canEdit && <AddRow placeholder="Add a factor of your own, e.g. Reputational impact" onAdd={add} />}
      <Removed items={custom.filter((f) => f.archived)} noun="tiers" onRestore={restore} canEdit={canEdit} />
    </div>
  );
}

export function EvidenceEditor({ builtin, value, usedBy, canEdit, onChange }: {
  builtin: Record<string, string>; value: EvidenceDraft; usedBy: Record<string, string[]>; canEdit: boolean;
  onChange: (next: EvidenceDraft) => void;
}) {
  const setBuiltin = (key: string, patch: { label?: string; hidden?: boolean }) => {
    const next = { ...(value.evidence_builtin[key] || {}), ...patch };
    if (!next.label) delete next.label;
    if (!next.hidden) delete next.hidden;
    const all = { ...value.evidence_builtin, [key]: next };
    if (!Object.keys(next).length) delete all[key];
    onChange({ ...value, evidence_builtin: all });
  };
  const setOwn = (key: string, patch: Partial<Named>) => onChange({ ...value, evidence: value.evidence.map((e) => (e.key === key ? { ...e, ...patch } : e)) });
  const add = (label: string) => onChange({ ...value, evidence: [...value.evidence, { key: newKey(label, [...Object.keys(builtin), ...value.evidence.map((e) => e.key)]), label }] });
  const used = (key: string) => usedBy[key]?.length ? `Asked for by: ${usedBy[key].join('; ')}` : '';
  const BADGE = 'rounded-full border px-[8px] text-ds-label';
  return (
    <div>
      <p className="mb-[8px] text-ds-body text-ds-fg-muted">
        The evidence a tier, or a yes to an onboarding question, can ask a supplier for. Tag a supplier’s documents with these to show what is in hand. Hiding or taking one out stops it being asked for;
        documents already tagged keep it.
      </p>
      <ul className="m-0 flex list-none flex-col divide-y divide-ds-border rounded-ds-control border border-ds-border p-0">
        {Object.entries(builtin).map(([key, label]) => {
          const change = value.evidence_builtin[key] || {};
          const blocked = !!usedBy[key]?.some((u) => u.startsWith('Question'));
          return (
            <li key={key} className={clsx('flex flex-wrap items-center gap-[8px] px-[12px] py-[8px]', change.hidden && 'bg-ds-surface-subtle')}>
              <TextInput value={change.label ?? label} disabled={!canEdit || change.hidden} aria-label="Evidence type name" className={clsx('min-w-0 flex-1 basis-[10rem]', change.hidden && 'line-through')}
                onChange={(e) => setBuiltin(key, { label: e.target.value === label ? undefined : e.target.value })} />
              <span className={clsx(BADGE, 'border-ds-border bg-ds-surface-subtle text-ds-fg-muted')}>Built-in</span>
              <Checkbox label="Hide" checked={!!change.hidden} disabled={!canEdit || (blocked && !change.hidden)} title={used(key)}
                onChange={(e) => setBuiltin(key, { hidden: e.target.checked || undefined })} />
              {usedBy[key]?.length ? <p className={clsx('w-full', NOTE)}>{used(key)}</p> : null}
            </li>
          );
        })}
        {value.evidence.filter((e) => !e.archived).map((e) => {
          const blocked = !!usedBy[e.key]?.some((u) => u.startsWith('Question'));
          return (
            <li key={e.key} className="flex flex-wrap items-center gap-[8px] px-[12px] py-[8px]">
              <TextInput value={e.label} disabled={!canEdit} aria-label="Evidence type name" className="min-w-0 flex-1 basis-[10rem]" onChange={(ev) => setOwn(e.key, { label: ev.target.value })} />
              <span className={clsx(BADGE, 'border-ds-primary-soft bg-ds-primary-soft text-ds-primary-text')}>Yours</span>
              {canEdit && (
                <IconButton label={blocked ? `Cannot take out ${e.label}: a question asks for it` : `Take out ${e.label}`} disabled={blocked} onClick={() => setOwn(e.key, { archived: true })}>
                  <Trash2 aria-hidden />
                </IconButton>
              )}
              {usedBy[e.key]?.length ? <p className={clsx('w-full', NOTE)}>{used(e.key)}</p> : null}
            </li>
          );
        })}
      </ul>
      {canEdit && <AddRow placeholder="Add an evidence type, e.g. PCI DSS attestation of compliance" onAdd={add} />}
      <Removed items={value.evidence.filter((e) => e.archived)} noun="documents" onRestore={(key) => setOwn(key, { archived: false })} canEdit={canEdit} />
    </div>
  );
}
