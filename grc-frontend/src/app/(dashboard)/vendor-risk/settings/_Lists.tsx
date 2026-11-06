'use client';

// The tiering factors and the evidence types, built-in and your own. Built-in
// ones can be renamed (evidence) or hidden (evidence) but not deleted; your own
// can be added, renamed and taken out. Something a question still uses cannot
// be taken out until the question changes.

import { useState } from 'react';
import { clsx } from 'clsx';
import { Plus, Trash2, Undo2 } from 'lucide-react';
import { newKey } from './_Questions';
import { Unit, fieldCls, inputCls } from './_ui';

export interface Named { key: string; label: string; archived?: boolean }
export interface EvidenceDraft { evidence: Named[]; evidence_builtin: Record<string, { label?: string; hidden?: boolean }> }

/** The evidence types in use, by key, in this organisation's words. */
export function activeEvidence(builtin: Record<string, string>, d: EvidenceDraft): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(builtin).forEach(([k, l]) => { if (!d.evidence_builtin[k]?.hidden) out[k] = d.evidence_builtin[k]?.label || l; });
  d.evidence.filter((e) => !e.archived).forEach((e) => { out[e.key] = e.label; });
  return out;
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (label: string) => void }) {
  const [text, setText] = useState('');
  const add = () => { if (text.trim()) { onAdd(text.trim()); setText(''); } };
  return (
    <div className="mt-2 flex items-center gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        className={clsx(fieldCls, 'flex-1 border-dashed')} aria-label={placeholder} />
      <button type="button" onClick={add} disabled={!text.trim()}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
        <Plus className="h-4 w-4" /> Add
      </button>
    </div>
  );
}

function Removed({ items, noun, onRestore, canEdit }: { items: Named[]; noun: string; onRestore: (key: string) => void; canEdit: boolean }) {
  if (!items.length) return null;
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer">Taken out ({items.length}); {noun} already recorded against them are kept</summary>
      <ul className="mt-1 space-y-1">
        {items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-2 text-slate-600">
            {i.label}
            {canEdit && (
              <button type="button" onClick={() => onRestore(i.key)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary-700 hover:bg-primary-50">
                <Undo2 className="h-3 w-3" /> Put back
              </button>
            )}
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
        <div key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
          {r.builtin ? (
            <label htmlFor={`w-${r.key}`} className="min-w-0 flex-1 text-sm text-slate-700">{r.label}</label>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <input value={r.label} disabled={!canEdit} onChange={(e) => rename(r.key, e.target.value)} aria-label="Factor name"
                className={clsx(fieldCls, 'max-w-xs')} />
              {canEdit && (
                <button type="button" onClick={() => remove(r.key)} disabled={!!usedBy[r.key]?.length}
                  title={usedBy[r.key]?.length ? `Used by: ${usedBy[r.key].join('; ')}` : 'Take this factor out'}
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 sm:block" aria-hidden>
              <span className="block h-full rounded-full bg-primary-500" style={{ width: `${total ? ((weights[r.key] || 0) / total) * 100 : 0}%` }} />
            </span>
            <input id={`w-${r.key}`} type="number" min={0} max={100} className={inputCls} disabled={!canEdit} value={weights[r.key] ?? 0}
              aria-label={`Weight of ${r.label}`} onChange={(e) => onWeights({ ...weights, [r.key]: Number(e.target.value) })} />
            <Unit>%</Unit>
          </span>
          {!r.builtin && usedBy[r.key]?.length ? (
            <p className="w-full text-[11px] text-slate-400">Fed by: {usedBy[r.key].join('; ')}</p>
          ) : !r.builtin ? (
            <p className="w-full text-[11px] text-amber-700">No question feeds it yet; give one a score for it under Onboarding questions.</p>
          ) : null}
        </div>
      ))}
      <p className={clsx('mt-2 text-right text-xs', Math.round(total) === 100 ? 'text-emerald-700' : 'text-slate-500')}>
        Total {Math.round(total)}%{Math.round(total) !== 100 && ' — scaled to 100% when saved'}
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
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        The evidence a tier, or a yes to an onboarding question, can ask a supplier for. Tag a supplier’s documents with these to
        show what is in hand. Hiding or taking one out stops it being asked for; documents already tagged keep it.
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {Object.entries(builtin).map(([key, label]) => {
          const change = value.evidence_builtin[key] || {};
          const blocked = !!usedBy[key]?.some((u) => u.startsWith('Question'));
          return (
            <li key={key} className={clsx('flex flex-wrap items-center gap-2 px-3 py-2', change.hidden && 'bg-slate-50')}>
              <input value={change.label ?? label} disabled={!canEdit || change.hidden} aria-label="Evidence type name"
                onChange={(e) => setBuiltin(key, { label: e.target.value === label ? undefined : e.target.value })}
                className={clsx(fieldCls, 'min-w-0 flex-1', change.hidden && 'line-through')} />
              <span className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-px text-[10px] text-slate-500">Built-in</span>
              <label className={clsx('flex items-center gap-1 text-xs text-slate-600', blocked && !change.hidden && 'opacity-50')} title={used(key)}>
                <input type="checkbox" checked={!!change.hidden} disabled={!canEdit || (blocked && !change.hidden)}
                  onChange={(e) => setBuiltin(key, { hidden: e.target.checked || undefined })} /> Hide
              </label>
              {usedBy[key]?.length ? <p className="w-full text-[11px] text-slate-400">{used(key)}</p> : null}
            </li>
          );
        })}
        {value.evidence.filter((e) => !e.archived).map((e) => {
          const blocked = !!usedBy[e.key]?.some((u) => u.startsWith('Question'));
          return (
            <li key={e.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <input value={e.label} disabled={!canEdit} aria-label="Evidence type name" onChange={(ev) => setOwn(e.key, { label: ev.target.value })}
                className={clsx(fieldCls, 'min-w-0 flex-1')} />
              <span className="rounded-full border border-primary-200 bg-primary-50 px-1.5 py-px text-[10px] text-primary-800">Yours</span>
              {canEdit && (
                <button type="button" onClick={() => setOwn(e.key, { archived: true })} disabled={blocked} title={blocked ? used(e.key) : 'Take this type out'}
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {usedBy[e.key]?.length ? <p className="w-full text-[11px] text-slate-400">{used(e.key)}</p> : null}
            </li>
          );
        })}
      </ul>
      {canEdit && <AddRow placeholder="Add an evidence type, e.g. PCI DSS attestation of compliance" onAdd={add} />}
      <Removed items={value.evidence.filter((e) => e.archived)} noun="documents"
        onRestore={(key) => setOwn(key, { archived: false })} canEdit={canEdit} />
    </div>
  );
}
