/**
 * What the "Compliance programme" card of the Review stage says, without a server or a screen: the scope in a line, the controls in a line, the people, the
 * one button that applies the proposed owner and why it is off. The rules (what starts, what is only proposed, what a run changes) are the server's
 * (`backend/grc/modules/framework_onboarding/programme.py`); this words its answer. Pure, so `node --test` pins it (programmeModel.test.ts).
 */
import type { ProgrammePerson, ProgrammeScope, ProgrammeView } from '@/lib/frameworkOnboarding';

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What has not started, and where it does: said once, so nobody reads the card as a compliance result. */
export const NOT_STARTED_WORDS = 'Assessments, control testing, evidence review, findings and compliance status begin in the journey. Nothing here is marked compliant.';

/** "Whole organisation", "Selected parts: 1 department, 2 systems", or "Not stated" when the onboarding never said. */
export function scopeWords(s: Pick<ProgrammeScope, 'reach' | 'whole_organisation' | 'departments' | 'systems' | 'locations' | 'processes' | 'third_parties'>): string {
  if (s.whole_organisation) return 'Whole organisation';
  if (!s.reach) return 'Not stated';
  const parts = [
    s.departments.length > 0 && count(s.departments.length, 'department'),
    s.systems.length > 0 && count(s.systems.length, 'system'),
    s.locations.length > 0 && count(s.locations.length, 'location'),
    s.processes.length > 0 && count(s.processes.length, 'process', 'processes'),
    s.third_parties.length > 0 && count(s.third_parties.length, 'third party', 'third parties'),
  ].filter((p): p is string => typeof p === 'string');
  return parts.length > 0 ? `Selected parts: ${parts.join(', ')}` : 'Selected parts';
}

/** "114 controls loaded, none assessed yet" (what a new journey holds); when work had begun already: "114 controls loaded, 12 with work begun". */
export function controlsWords(c: NonNullable<ProgrammeView['controls']>): string {
  if (c.total === 0) return 'No controls in the journey yet';
  return c.begun === 0 ? `${count(c.total, 'control')} loaded, none assessed yet` : `${count(c.total, 'control')} loaded, ${c.begun} with work begun`;
}

/** "Sana", or "Zed Auditor (no account)": a person without an account is named and never assigned. */
export const personWords = (p: Pick<ProgrammePerson, 'name' | 'account'>): string => (p.account ? p.name : `${p.name} (no account)`);

export interface OwnerAction { shown: boolean; enabled: boolean; label: string; reason: string | null }

/** The button that makes the programme owner the owner of the controls nobody owns: shown when an owner was named, off with a reason when it cannot apply. */
export function ownerAction(o: ProgrammeView['owner']): OwnerAction {
  if (!o || !o.name) return { shown: false, enabled: false, label: '', reason: null };
  const label = o.without_owner > 0 ? `Make ${o.name} owner of ${count(o.without_owner, 'control')}` : `Make ${o.name} owner of the controls`;
  if (o.can_apply) return { shown: true, enabled: true, label, reason: null };
  return { shown: true, enabled: false, label, reason: o.why_not ?? (o.without_owner === 0 ? 'Every control has an owner already.' : null) };
}
