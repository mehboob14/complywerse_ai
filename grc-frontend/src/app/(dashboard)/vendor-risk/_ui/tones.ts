// Status words -> tone, and the colours of each tone. Pure, so `node --test` runs tones.test.ts against it.
// The tone model (Tone, TONE and the word lookup) lives in src/lib/status.ts, the platform's status registry, and is re-exported here, so every import of this kit and tones.test.ts stay
// as they were. The word maps themselves moved to src/lib/statuses/vendor.ts (vendor-shell, 2026-11-08): this file is an ADAPTER over those registries until no page imports it; a page that
// moves to components/ui/ds imports the registry instead (migration rule: G13_vendor-shell_plan.md section 5). Anything not registered reads as neutral, never as a guess.
import type { Tone } from '../../../../lib/status.ts';
import {
  vendorAssessment, vendorCondition, vendorContract, vendorDecision, vendorDocument, vendorFinding, vendorGrade, vendorLifecycle, vendorScreening, vendorStage, vendorUrgency,
} from '../../../../lib/statuses/vendor.ts';

export { TONE, type Tone, type ToneColors } from '../../../../lib/status.ts';

const word = (registry: { tone: (word?: string | null) => Tone }) => (s?: string | null): Tone => registry.tone(s);

export const tones = {
  lifecycle: word(vendorLifecycle),
  finding: word(vendorFinding),
  decision: word(vendorDecision),
  assessment: word(vendorAssessment),
  document: word(vendorDocument),
  contract: word(vendorContract),
  urgency: word(vendorUrgency),
  screening: word(vendorScreening),
  grade: word(vendorGrade),
  // added to the contract: a stage's own status, and a decision's conditions ("open" means warning here, danger on a finding)
  stage: word(vendorStage),
  condition: word(vendorCondition),
};
