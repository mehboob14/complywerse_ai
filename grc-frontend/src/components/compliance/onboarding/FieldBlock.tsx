'use client';

/**
 * One question: its label (with a quiet "advised" or "optional" beside it; a required question has none, most are), an (i) holding the note that says why it
 * is asked and who asks, a small source chip, the input, and the error under it. The source is the one given, else the field's own. A single control
 * (a text box, a list) is named by a real label; a group of controls (segments, ticks, a table) is named by the same words as a group.
 */
import { useId } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';
import type { FieldInputProps, Source } from '@/lib/frameworkOnboarding';
import FieldInput from './FieldInput';
import SourceChip from './SourceChip';
import { hasSingleControl, levelWord } from './fieldModel';

const LABEL = 'min-w-0 break-words text-ds-label text-ds-fg';

export default function FieldBlock({ source, label, ...input }: FieldInputProps & { source?: Source | null; label?: string }) {
  const auto = useId();
  const id = input.id ?? auto;
  const f = input.field;
  const text = label ?? f.label;
  const note = 'note' in f ? f.note : '';
  const marker = levelWord('level' in f ? f.level : undefined);
  const chosen = source === undefined ? ('source' in f ? f.source : null) : source;

  return (
    <div className="min-w-0 space-y-[6px]" data-field={f.key}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-[6px] gap-y-[2px]">
        {hasSingleControl(f) ? <label id={`${id}-label`} htmlFor={id} className={LABEL}>{text}</label> : <span id={`${id}-label`} className={LABEL}>{text}</span>}
        {marker && <span className="text-ds-label font-normal text-ds-fg-muted">{`(${marker})`}</span>}
        {note && <InfoTip text={note} label={`About ${text.toLowerCase()}`} />}
        <SourceChip source={chosen} />
      </div>
      <FieldInput {...input} id={id} />
    </div>
  );
}
