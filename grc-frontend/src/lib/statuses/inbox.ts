// The words "Needs my action" puts on a request (app/(dashboard)/needs-my-action): what else is true of it besides its due line (which is a sentence of its own: "Overdue by 3 days"). They are not a
// record's status (the document's own words are in the Governance registry); they are what the inbox adds, always as a word, never a colour alone. Tones: danger = escalated (people were told it is
// late), pending = asked again after changes, neutral = information. A word nobody registered reads neutral with a readable label (lib/status.ts).
import { defineStatuses } from '../status.ts';

export const inboxChip = defineStatuses('inbox chip', {
  escalated: 'danger',
  asked_again: { tone: 'pending', label: 'Asked again' },
  archived: 'neutral',
  can_decide: { tone: 'neutral', label: 'You can decide' },
});
