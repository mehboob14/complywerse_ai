'use client';

// The form of one register row, in a right panel: the register's own sections, each column as the field its kind asks for (a pick-list, a date, a text),
// the requirement, risk, person and evidence pickers, and what the server said when a save failed (at the top of the form, with Retry, the typed text kept).
// It is opened by "Add row" and by pressing a row. A panel with typed text asks before it is closed (`dirty`).
import { Sparkles } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, FormError, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { UNASSIGNED } from '@/lib/format';
import {
  EVIDENCE_KEY, controlOptions, controlStores, hasEvidenceColumn, pickControl, pickRisk, riskOptions, withCurrent,
  type ControlLite, type Person, type RegColumn, type RegDef, type RiskLite,
} from './registerModel';

export interface FormContext {
  people: Person[];
  controls: ControlLite[];
  /** the risks of this framework (Risk Treatment only); null for a register that has no risk picker */
  risks: RiskLite[] | null;
  risksFailed: boolean;
  /** the evidence library as names; undefined while it loads */
  evidence: string[] | undefined;
  evidenceFailed: boolean;
}

interface Props {
  def: RegDef;
  mode: 'add' | 'edit';
  frameworkName: string;
  draft: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  dirty: boolean;
  saving: boolean;
  problem: unknown;
  onRetry: () => void;
  onSave: () => void;
  onClose: () => void;
  ctx: FormContext;
  /** a generated register can ask the AI to fill the form for the person to review */
  onAi?: () => void;
  aiBusy?: boolean;
}

const text = (v: unknown): string => (v == null ? '' : String(v));

export default function RegisterForm({ def, mode, frameworkName, draft, onChange, dirty, saving, problem, onRetry, onSave, onClose, ctx, onAi, aiBusy }: Props) {
  const set = (key: string, value: unknown) => onChange({ [key]: value });
  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={mode === 'add' ? `Add a row to ${def.label}` : `Edit ${def.label}`}
      subtitle={frameworkName}
      width="w-full max-w-[640px]"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          {onAi ? <Button leftIcon={<Sparkles aria-hidden />} loading={aiBusy} onClick={onAi}>AI assess this row</Button> : <span />}
          <div className="flex gap-[8px]">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={onSave}>{mode === 'add' ? 'Add row' : 'Save changes'}</Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-[20px]">
        <FormError title={mode === 'add' ? "Couldn't add the row" : "Couldn't save the row"} error={problem} onRetry={onRetry} />
        {def.sections.map((section) => (
          <div key={section.title || 'all'}>
            {section.title && <h3 className="mb-[12px] !text-ds-label !font-[600] !text-ds-fg-muted">{section.title}</h3>}
            <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
              {section.keys.map((key) => {
                const col = def.columns.find((c) => c.key === key);
                if (!col) return null;
                return (
                  <div key={key} className={col.kind === 'textarea' ? 'sm:col-span-2' : undefined}>
                    <FormField label={col.label}>
                      <Field def={def} col={col} draft={draft} set={set} onChange={onChange} ctx={ctx} />
                    </FormField>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {def.shape === 'data' && !hasEvidenceColumn(def) && (
          <div>
            <h3 className="mb-[12px] !text-ds-label !font-[600] !text-ds-fg-muted">Evidence</h3>
            <FormField label="Linked evidence" optional hint={ctx.evidenceFailed ? "The evidence library didn't load." : undefined}>
              <Combobox
                label="Linked evidence"
                options={withCurrent((ctx.evidence ?? []).map((n) => ({ value: n, label: n })), text(draft[EVIDENCE_KEY]))}
                value={text(draft[EVIDENCE_KEY]) || null}
                onChange={(v) => set(EVIDENCE_KEY, v ?? '')}
                placeholder="Not set"
                searchPlaceholder="Search evidence"
                emptyText="No evidence in the library"
                clearable
              />
            </FormField>
          </div>
        )}
      </div>
    </RightSlidePanel>
  );
}

function Field({ def, col, draft, set, onChange, ctx }: {
  def: RegDef; col: RegColumn; draft: Record<string, unknown>; set: (key: string, value: unknown) => void; onChange: (patch: Record<string, unknown>) => void; ctx: FormContext;
}) {
  const value = draft[col.key];

  if (col.picker === 'framework_risks') {
    const risks = ctx.risks ?? [];
    const chosen = typeof draft.risk_register_id === 'number' ? String(draft.risk_register_id) : null;
    return (
      <>
        <Combobox
          label={col.label}
          options={riskOptions(risks)}
          value={chosen}
          onChange={(v) => onChange(pickRisk(draft, v ? Number(v) : null, risks))}
          placeholder="Choose a risk of this framework"
          searchPlaceholder="Search risks"
          emptyText="No risks yet"
          clearable
        />
        {(ctx.risksFailed || risks.length === 0) && (
          <p className="mt-[4px] text-ds-label text-ds-fg-muted">
            {ctx.risksFailed ? "The risks didn't load." : 'No risks of this framework yet. Move rows over from Gap Analysis or Internal Audit, or add risks to the risk register under this framework.'}
          </p>
        )}
      </>
    );
  }

  if (col.picker === 'framework_controls') {
    const current = text(value);
    const none = ctx.controls.length === 0;
    return (
      <>
        <Combobox
          label={col.label}
          options={controlOptions(ctx.controls, current, controlStores(def, col))}
          value={current || null}
          onChange={(v) => onChange(pickControl(col, v ?? '', ctx.controls))}
          placeholder="Choose a requirement"
          searchPlaceholder="Search requirements"
          emptyText="No requirements"
          clearable
        />
        {none && <p className="mt-[4px] text-ds-label text-ds-fg-muted">Requirements come from this framework&apos;s Requirements tab.</p>}
      </>
    );
  }

  if (col.picker === 'users') {
    const current = text(value);
    return (
      <Combobox
        label={col.label}
        options={withCurrent(ctx.people.map((p) => ({ value: p.name, label: p.name })), current)}
        value={current || null}
        onChange={(v) => set(col.key, v ?? '')}
        placeholder={UNASSIGNED}
        searchPlaceholder="Search people"
        emptyText="No people"
        clearable
      />
    );
  }

  if (col.picker === 'evidence') {
    const current = text(value);
    return (
      <>
        <Combobox
          label={col.label}
          options={withCurrent((ctx.evidence ?? []).map((n) => ({ value: n, label: n })), current)}
          value={current || null}
          onChange={(v) => set(col.key, v ?? '')}
          placeholder="Not set"
          searchPlaceholder="Search evidence"
          emptyText="No evidence in the library"
          clearable
        />
        {ctx.evidenceFailed && <p className="mt-[4px] text-ds-label text-ds-fg-muted">The evidence library didn&apos;t load.</p>}
      </>
    );
  }

  switch (col.kind) {
    case 'auto':
      return <TextInput readOnly value={text(value)} placeholder="Given when the row is saved" />;
    case 'select':
      return (
        <Select placeholder="Not set" value={text(value)} onChange={(e) => set(col.key, e.target.value)}>
          {(col.options ?? []).filter((o) => o.value !== '').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    case 'owner':
      return (
        <Select placeholder={UNASSIGNED} value={value == null ? '' : String(value)} onChange={(e) => set(col.key, e.target.value ? Number(e.target.value) : null)}>
          {ctx.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      );
    case 'date':
      return <TextInput type="date" value={value ? text(value).slice(0, 10) : ''} onChange={(e) => set(col.key, e.target.value || null)} />;
    case 'datetime':
      return <TextInput type="datetime-local" value={value ? text(value).slice(0, 16) : ''} onChange={(e) => set(col.key, e.target.value || null)} />;
    case 'textarea':
      return <Textarea rows={3} value={text(value)} onChange={(e) => set(col.key, e.target.value)} />;
    default:
      return <TextInput value={text(value)} onChange={(e) => set(col.key, e.target.value)} />;
  }
}
