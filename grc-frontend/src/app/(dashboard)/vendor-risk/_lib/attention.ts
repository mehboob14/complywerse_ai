// The one thing a vendor can be waiting on (backend routers/vendors.py NEXT_ACTIONS: the first that holds wins), in the register's own order, with the words and the colour family the
// Overview and the Register give each. The words are lib/statuses/vendor.ts `vendorNextStep` (the tests pin them against the server's table); this file only lists them in order.
// Pure, so `node --test` runs registerModel.test.ts against it.
import type { Tone } from '../../../../lib/status.ts';
import { vendorNextStep } from '../../../../lib/statuses/vendor.ts';

export interface AttentionCode { code: string; label: string; tone: Tone }

// danger: already late; warning: something is missing; progress: someone is working on it
export const ATTENTION: AttentionCode[] = vendorNextStep.words.map((code) => ({ code, label: vendorNextStep.label(code), tone: vendorNextStep.tone(code) }));

export const ATTENTION_CODES: string[] = ATTENTION.map((a) => a.code);

export const attentionTone = (code?: string | null): Tone => vendorNextStep.tone(code);
export const attentionLabel = (code: string): string => vendorNextStep.label(code);
