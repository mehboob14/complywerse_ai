// The words the Vendors register, its Contracts and its yearly Check-ins add to the module's registry (lib/statuses/vendor.ts, the shell's): how sensitive the data a vendor holds is, where a
// contract stands against its dates, and where a yearly check-in stands. Every word is said in words, never a colour alone; a word nobody registered reads neutral with its own label.
// Pure (no React), so `node --test` runs vendorRegister.test.ts against it.
import { defineStatuses } from '../status.ts';

/** How sensitive the data a vendor holds is: public and internal are plain, confidential needs care, restricted is the alarm. */
export const vendorClassification = defineStatuses('data classification', {
  public: { tone: 'neutral', label: 'Public' },
  internal: { tone: 'neutral', label: 'Internal' },
  confidential: { tone: 'warning', label: 'Confidential' },
  restricted: { tone: 'danger', label: 'Restricted' },
});

/** Where a contract stands against its dates (contracts/shared.ts ContractState): past its date is late, a notice to give is a decision, running is fine. */
export const contractState = defineStatuses('contract state', {
  lapsed: { tone: 'danger', label: 'Past its date' },
  decide: { tone: 'warning', label: 'Decide now' },
  ending: { tone: 'progress', label: 'Ending soon' },
  in_force: { tone: 'success', label: 'In force' },
  draft: { tone: 'neutral', label: 'Draft' },
  ended: { tone: 'neutral', label: 'Ended' },
});

/** Where a yearly check-in stands. */
export const checkinState = defineStatuses('check-in', {
  overdue: { tone: 'danger', label: 'Overdue' },
  due_soon: { tone: 'warning', label: 'Due soon' },
  upcoming: { tone: 'neutral', label: 'Upcoming' },
  done: { tone: 'success', label: 'Done' },
});
