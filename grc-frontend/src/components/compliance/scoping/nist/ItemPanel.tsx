'use client';

/**
 * One NIST item opened in the drawer. A control (SP 800-53A): its statement, every assessment objective with the assessor's determination (Satisfied, Other than satisfied,
 * Not applicable) and a note, the artifacts NIST names with the evidence filed under each, the finding (what is wrong, what would put it right), who it is
 * assigned to and the AI evidence advice. A subcategory (CSF 2.0): its outcome, the current implementation and the target, NIST's implementation examples as artifacts.
 * Every change is saved at once through the server's decision call; the status is the server's (it derives it from the decisions).
 */
import { useEffect, useRef, useState } from 'react';
import { Menu, SegmentedControl, Select, StatusPill, Textarea, type MenuItem } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import ItemAssignees from '../../ItemAssignees';
import { AiEvidenceButton, AiEvidenceDialog } from '../../AiEvidenceAdvisor';
import ArtifactRows from './ArtifactRows';
import { nistApi, type Decision } from './nistApi';
import {
  DETERMINATION_LABEL, IMPLEMENTATION_LABEL, isControl, isProfile, progressOf, statusTone, statusWord,
  type Determination, type Implementation, type NistItem, type Objective,
} from './nistModel';

const DET_OPTIONS = (Object.keys(DETERMINATION_LABEL) as Determination[]).map((value) => ({ value, label: DETERMINATION_LABEL[value] }));
const IMPLEMENTATIONS = Object.keys(IMPLEMENTATION_LABEL) as Implementation[];

/** A note kept as typed and saved when the person leaves the field (a save per keystroke would race its own answers). */
function Note({ value, label, onSave, disabled }: { value: string; label: string; onSave: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setText(value); } }, [value]);
  return (
    <Textarea aria-label={label} rows={2} maxLength={1000} value={text} placeholder="Note: what was seen, who said it" disabled={disabled} onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== last.current) { last.current = text; onSave(text); } }} />
  );
}

function ObjectiveRow({ item, o, decide, busy }: { item: NistItem; o: Objective; decide: (d: Decision) => void; busy: boolean }) {
  const [noting, setNoting] = useState(false);
  return (
    <li className="rounded-ds-card border border-ds-border p-[12px]">
      <p className="break-words text-ds-body text-ds-fg-body"><span className="mr-[6px] text-ds-label text-ds-fg-muted">{o.id}</span>{o.text}</p>
      <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
        <SegmentedControl label={`Determination for ${o.id}`} name={`det-${item.id}-${o.id}`} options={DET_OPTIONS} value={(o.determination ?? '') as Determination} disabled={busy}
          onChange={(value) => decide({ objective: o.id, determination: value })} />
        {o.determination && <button type="button" className="rounded-ds-control text-ds-label text-ds-fg-muted underline underline-offset-2 hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring" onClick={() => decide({ objective: o.id, determination: null })}>Clear</button>}
        {!o.note && !noting && <button type="button" className="rounded-ds-control text-ds-label text-ds-primary-text underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-ds-ring" onClick={() => setNoting(true)}>Add a note</button>}
      </div>
      {(o.note || noting || o.determination === 'other_than_satisfied') && (
        <div className="mt-[8px]"><Note label={`Note on ${o.id}`} value={o.note} onSave={(note) => decide({ objective: o.id, note })} /></div>
      )}
    </li>
  );
}

export default function ItemPanel({ assessmentId, assessmentName, item, decide, busy, onChanged }: {
  assessmentId: number; assessmentName: string; item: NistItem; decide: (d: Decision) => void; busy: boolean; onChanged: () => void;
}) {
  const [advice, setAdvice] = useState(false);
  const d = item.assessment_data;
  const progress = progressOf(item);
  const everything: MenuItem[] = (Object.keys(DETERMINATION_LABEL) as Determination[]).map((value) => ({ key: value, label: DETERMINATION_LABEL[value], onSelect: () => decide({ all: value }) }));

  return (
    <div className="space-y-[20px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill tone={statusTone(item)} label={statusWord(item)} />
        {isControl(d) && progress.total > 0 && <span className="text-ds-body text-ds-fg-muted">{progress.determined} of {progress.total} objectives determined</span>}
        <span className="ml-auto flex items-center gap-[8px]">
          <ItemAssignees itemId={item.id} value={item.assignees} onSaved={onChanged} label={item.item_number} />
          <AiEvidenceButton assessmentId={assessmentId} itemId={item.id} active={advice} onOpen={() => setAdvice(true)} />
        </span>
      </div>

      {isControl(d) && (
        <>
          <details className="rounded-ds-card border border-ds-border px-[12px] py-[8px]">
            <summary className="cursor-pointer text-ds-body font-[600] text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">Control statement</summary>
            <p className="mt-[8px] whitespace-pre-line break-words text-ds-body text-ds-fg-body">{d.statement}</p>
          </details>
          <section aria-labelledby={`obj-${item.id}`}>
            <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
              <h3 id={`obj-${item.id}`} className="flex items-center gap-[4px] text-ds-body font-[600] text-ds-fg">
                Objectives
                <InfoTip label="About the objectives" text="NIST SP 800-53A: each objective is determined Satisfied, Other than satisfied or Not applicable. The control is satisfied only when every objective is." />
              </h3>
              <Menu label="Set every objective" items={everything} />
            </div>
            <ul className="space-y-[8px]">
              {d.objectives.map((o) => <ObjectiveRow key={o.id} item={item} o={o} decide={decide} busy={busy} />)}
            </ul>
          </section>
        </>
      )}

      {isProfile(d) && (
        <section className="space-y-[12px]">
          <p className="break-words text-ds-body text-ds-fg-body">{d.outcome}</p>
          {d.category_title && <p className="text-ds-label text-ds-fg-muted">{d.function_name.charAt(0) + d.function_name.slice(1).toLowerCase()} · {d.category_title}</p>}
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <label className="block text-ds-label text-ds-fg-muted">Current
              <Select value={d.current ?? ''} disabled={busy} onChange={(e) => decide({ current: (e.target.value || null) as Implementation | null })} className="mt-[4px]">
                <option value="">Not rated</option>
                {IMPLEMENTATIONS.map((k) => <option key={k} value={k}>{IMPLEMENTATION_LABEL[k]}</option>)}
              </Select>
            </label>
            <label className="block text-ds-label text-ds-fg-muted">Target
              <Select value={d.target ?? ''} disabled={busy} onChange={(e) => decide({ target: (e.target.value || null) as Implementation | null })} className="mt-[4px]">
                <option value="">No target</option>
                {IMPLEMENTATIONS.filter((k) => k !== 'NA').map((k) => <option key={k} value={k}>{IMPLEMENTATION_LABEL[k]}</option>)}
              </Select>
            </label>
          </div>
          <Note label="Note on the rating" value={d.note ?? ''} onSave={(note) => decide({ note })} />
        </section>
      )}

      <section aria-labelledby={`art-${item.id}`}>
        <h3 id={`art-${item.id}`} className="mb-[8px] flex items-center gap-[4px] text-ds-body font-[600] text-ds-fg">
          Artifacts and evidence
          <InfoTip label="About artifacts" text={isControl(d) ? 'What NIST SP 800-53A names for this control: the objects to examine, the people to interview, the things to test. Upload evidence for each, or for the control as a whole.' : 'NIST\'s implementation examples of this outcome: what it can look like in practice. Upload evidence for each, or for the outcome as a whole.'} />
        </h3>
        <ArtifactRows assessmentId={assessmentId} item={item} onChanged={onChanged} />
      </section>

      <section aria-labelledby={`finding-${item.id}`} className="space-y-[8px]">
        <h3 id={`finding-${item.id}`} className="text-ds-body font-[600] text-ds-fg">Finding</h3>
        <FindingField label="What is wrong" value={item.gaps_identified ?? ''} onSave={(text) => nistApi.setFinding(item.id, { gaps_identified: text }).then(onChanged)} />
        <FindingField label="What would put it right" value={item.proposed_solution ?? ''} onSave={(text) => nistApi.setFinding(item.id, { proposed_solution: text }).then(onChanged)} />
      </section>

      {advice && <AiEvidenceDialog assessmentId={assessmentId} item={{ id: item.id, item_number: item.item_number, control_description: item.control_description }} context={assessmentName} onClose={() => setAdvice(false)} onLinked={onChanged} />}
    </div>
  );
}

function FindingField({ label, value, onSave }: { label: string; value: string; onSave: (text: string) => Promise<unknown> | void }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setText(value); } }, [value]);
  return (
    <label className="block text-ds-label text-ds-fg-muted">{label}
      <Textarea rows={2} maxLength={2000} value={text} className="mt-[4px]" onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== last.current) { last.current = text; void onSave(text); } }} />
    </label>
  );
}
