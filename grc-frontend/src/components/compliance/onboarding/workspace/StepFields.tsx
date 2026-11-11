'use client';

/**
 * One step of the onboarding: its fields in the catalog's order, minus the ones an earlier answer switched off. Every field is drawn by `renderField`, the one
 * place that knows which component draws a field (the shared field block, which the organisation profile uses too). What a field is, where its
 * answer goes and when it is asked are the server's; this only lays them out and points each at its value, its error and its help.
 */
import type { ReactNode } from 'react';
import type { Department, Field, OnboardingView, OrgRows, Refs, Step } from '@/lib/frameworkOnboarding';
import FieldBlock from '../FieldBlock';
import { fieldRef, valueOf, visibleFields, type Edits } from './workspaceModel';

export interface FieldContext {
  refs: Refs;
  onRefs: (patch: Partial<Refs>) => void;
  orgRows: OrgRows;
  departments: Department[];
  readOnly: boolean;
}

/** The DOM id of the box that holds one field, so a check can bring a person to it. */
export const fieldBoxId = (base: string, step: string, field: string): string => `${base}-field-${step}-${field}`;

// The one place that draws a field: the shared field block (the same one the organisation profile uses).
function renderField(field: Field, value: unknown, onChange: (v: unknown) => void, error: string | null, ctx: FieldContext, id: string): ReactNode {
  return (
    <FieldBlock
      field={field} value={value} onChange={onChange} error={error} readOnly={ctx.readOnly} id={id} source={field.type === 'files' ? null : field.source}
      refs={ctx.refs} onRefs={ctx.onRefs} orgRows={ctx.orgRows} departments={ctx.departments}
    />
  );
}

export default function StepFields({ step, view, edits, errors, ctx, base, onChange, after }: {
  step: Step;
  view: Pick<OnboardingView, 'answers' | 'readiness'>;
  edits: Edits;
  errors: Record<string, string>;
  ctx: FieldContext;
  base: string;
  onChange: (step: string, field: string, value: unknown) => void;
  /** what goes under a field (the AI help that belongs to it) */
  after?: (field: string) => ReactNode;
}) {
  const fields = visibleFields(step, view.readiness);
  if (fields.length === 0) return <p className="text-ds-body text-ds-fg-muted">Nothing is asked here for your answers so far.</p>;
  return (
    <div className="flex flex-col gap-[20px]">
      {fields.map((f) => {
        const ref = fieldRef(step.key, f.key);
        const box = fieldBoxId(base, step.key, f.key);
        return (
          <div key={f.key} id={box} tabIndex={-1} className="min-w-0 scroll-mt-[72px] focus-visible:outline-none">
            {renderField(f, valueOf(view.answers, edits, step.key, f.key), (v) => onChange(step.key, f.key, v), errors[ref] ?? null, ctx, `${box}-input`)}
            {after?.(f.key)}
          </div>
        );
      })}
    </div>
  );
}
