'use client';

// "Start assessment": the menu of the kinds that are made for one application, function or system (Menu of the kit) and the dialog that says what it is of (StartDialog, which makes the draft
// and opens it). The same button on the Overview, All assessments and Types. A kind whose questionnaire is not uploaded yet is in the menu but cannot be chosen, and says why: Start needs the
// questions it copies (the Types page is where they are uploaded).
import { useState } from 'react';
import { Menu, type MenuItem } from '@/components/ui/ds';
import StartDialog from '@/components/compliance/scoping/StartDialog';
import { useTemplates } from '../_data/assessmentData';
import { SPECS } from './typesModel';

const STARTABLE = SPECS.filter((s) => s.begin === 'start');

export function StartMenu() {
  const [starting, setStarting] = useState<string | null>(null);
  const templates = useTemplates();
  const ready = (format: string): boolean => format.startsWith('nist_') || !!templates.data?.find((t) => t.assessment_format === format)?.questionnaire;
  const items: MenuItem[] = STARTABLE.map((s) => {
    const blocked = !templates.isPending && !ready(s.format);
    return { key: s.format, label: s.label, disabled: blocked, reason: blocked ? 'Upload its questionnaire first (Types)' : undefined, onSelect: () => setStarting(s.format) };
  });
  return (
    <>
      <Menu label="Start assessment" items={items} />
      {starting && <StartDialog format={starting} onClose={() => setStarting(null)} />}
    </>
  );
}
