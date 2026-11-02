// The one thing a vendor can be waiting on (backend routers/vendors.py NEXT_ACTIONS: the first that holds wins), in the register's
// own order, with the words and the colour family the Overview and the Register give each. Pure, so `node --test` runs
// registerModel.test.ts against it.
import type { Tone } from '../_ui/tones.ts';

export interface AttentionCode { code: string; label: string; tone: Tone }

// danger: already late; warning: something is missing; progress: someone is working on it
export const ATTENTION: AttentionCode[] = [
  { code: 'suspended', label: 'Suspended', tone: 'danger' },
  { code: 'reassessment_overdue', label: 'Reassessment overdue', tone: 'danger' },
  { code: 'not_tiered', label: 'Needs tiering', tone: 'warning' },
  { code: 'awaiting_approval', label: 'Awaiting approval', tone: 'progress' },
  { code: 'response_to_review', label: 'Answers to review', tone: 'progress' },
  { code: 'documents_expired', label: 'Documents expired', tone: 'danger' },
  { code: 'weak_grade', label: 'Weak grade', tone: 'warning' },
  { code: 'no_owner', label: 'No owner', tone: 'warning' },
  { code: 'reassessment_due', label: 'Reassessment due', tone: 'progress' },
  { code: 'offboarding', label: 'Finish offboarding', tone: 'warning' },
];

export const ATTENTION_CODES: string[] = ATTENTION.map((a) => a.code);

export const attentionTone = (code?: string | null): Tone => ATTENTION.find((a) => a.code === code)?.tone ?? 'neutral';
export const attentionLabel = (code: string): string => ATTENTION.find((a) => a.code === code)?.label ?? code;
