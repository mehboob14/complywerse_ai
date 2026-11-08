// node --test "src/app/(dashboard)/bcm/_record/recordModel.test.ts"
// The plan page and the drill page: the journey strip (where a record stands), the "what next" lines of the Overview tab, the order of a plan's processes and what a phone shows of the master-detail.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Bia, Drill, Plan } from '../bcmModel.ts';
import { biaDeleteWords, biaDirty, biaFormFrom, biaUpdatePayload, blankBiaForm } from '../bcmModel.ts';
import { drillJourney, drillNextSteps, lastDrillAt, masterDetail, openProcess, orderedProcesses, planJourney, planNextSteps } from './recordModel.ts';

const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime();
const at = (offset: number): string => { const d = new Date(2026, 10, 8 + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00`; };
const states = (j: { steps: Array<{ state: string }> }) => j.steps.map((s) => s.state);

test('a plan stands at Draft, Under review or Approved; a retired plan is off the way', () => {
  assert.deepEqual(planJourney('draft').steps.map((s) => s.label), ['Draft', 'Under review', 'Approved']);
  assert.deepEqual(states(planJourney('draft')), ['current', 'todo', 'todo']);
  assert.deepEqual(states(planJourney('under_review')), ['done', 'current', 'todo']);
  assert.deepEqual(states(planJourney('approved')), ['done', 'done', 'current']);
  const retired = planJourney('retired');
  assert.deepEqual(states(retired), ['todo', 'todo', 'todo']);
  assert.equal(retired.off, true);
  assert.equal(planJourney('approved').off, false);
  assert.deepEqual(states(planJourney('mystery')), ['current', 'todo', 'todo'], 'an unknown word reads as the start, never as an error');
});

test('a drill stands at Scheduled, In progress, Completed or Closed; under review sits at Completed and an overdue drill is still at Scheduled; cancelled is off the way', () => {
  assert.deepEqual(drillJourney('scheduled').steps.map((s) => s.label), ['Scheduled', 'In progress', 'Completed', 'Closed']);
  assert.deepEqual(states(drillJourney('in_progress')), ['done', 'current', 'todo', 'todo']);
  assert.deepEqual(states(drillJourney('closed')), ['done', 'done', 'done', 'current']);
  assert.deepEqual(states(drillJourney('under_review')), ['done', 'done', 'current', 'todo']);
  assert.deepEqual(states(drillJourney('cancelled')), ['todo', 'todo', 'todo', 'todo']);
  assert.equal(drillJourney('cancelled').off, true);
  assert.equal(drillJourney('scheduled').off, false);
});

const bia = (id: number, o: Partial<Bia> = {}): Bia => ({ id, plan_id: 1, process_name: `Process ${id}`, description: null, criticality_rating: 'medium', rto_hours: 4, rpo_hours: 1, mtpd_hours: 12, linked_risk_id: null, is_complete: true, dependency_count: 0, strategy_count: 1, ...o });
const plan = (o: Partial<Plan> = {}) => ({ status: 'approved', rto_hours: 4, rpo_hours: 1, next_review_due: at(200), bia_records: [bia(1)], drills: [{ scheduled_date: at(-30) }] as Drill[], ...o });

test('what a plan needs, most pressing first, from its own figures', () => {
  assert.deepEqual(planNextSteps(plan(), NOW), []);
  const needy = planNextSteps(plan({ status: 'draft', rto_hours: null, next_review_due: at(-3), bia_records: [bia(1, { is_complete: false }), bia(2, { is_complete: false }), bia(3)], drills: [] }), NOW);
  assert.deepEqual(needy.map((n) => n.key), ['objectives', 'review', 'bia-open', 'never-tested']);
  assert.equal(needy[1].text, 'Overdue by 3 days. Review the plan, then set its next review day.');
  assert.equal(needy[2].text, '2 processes have no recovery strategy.');
  assert.deepEqual(needy.map((n) => n.go), ['edit', 'edit', 'bia', 'schedule']);
  assert.deepEqual(planNextSteps(plan({ bia_records: [] }), NOW).map((n) => n.key), ['bia-none']);
  assert.equal(planNextSteps(plan({ bia_records: [bia(1, { is_complete: false })] }), NOW)[0].text, '1 process has no recovery strategy.');
  assert.equal(planNextSteps(plan({ next_review_due: at(10) }), NOW)[0].text, 'Review in 10 days.');
  assert.deepEqual(planNextSteps(plan({ drills: [{ scheduled_date: at(-400) }] as Drill[] }), NOW).map((n) => n.key), ['not-tested']);
  assert.deepEqual(planNextSteps(plan({ status: 'retired', rto_hours: null, bia_records: [], drills: [], next_review_due: at(-90) }), NOW), [], 'a retired plan has nothing to chase');
  assert.deepEqual(planNextSteps(plan({ status: 'approved', rto_hours: null }), NOW).map((n) => n.key), [], 'the rule is about approving: an approved plan is not nagged for it');
});

test('the latest drill of a plan is its latest scheduled day, or when it was made when it has no day', () => {
  assert.equal(lastDrillAt([]), null);
  assert.equal(lastDrillAt([{ scheduled_date: '2026-03-01T00:00:00' }, { scheduled_date: '2026-09-01T00:00:00' }, { scheduled_date: null, created_at: '2026-05-01T10:00:00' }]), '2026-09-01T00:00:00');
  assert.equal(lastDrillAt([{ scheduled_date: null, created_at: '2026-05-01T10:00:00' }]), '2026-05-01T10:00:00');
});

const drill = (o: Partial<Drill> = {}) => ({ status: 'scheduled', effective_status: 'scheduled', scheduled_date: at(40), has_result: false, finding_count: 0, findings: [], result: null, ...o });

test('what a drill needs: a late day, a result, open findings; closing is said, not enforced', () => {
  assert.deepEqual(drillNextSteps(drill(), NOW), []);
  assert.equal(drillNextSteps(drill({ scheduled_date: at(12) }), NOW)[0].text, 'Starts in 12 days.');
  assert.equal(drillNextSteps(drill({ effective_status: 'overdue', scheduled_date: at(-9) }), NOW)[0].text, 'Overdue by 9 days. Run it, or move its day.');
  assert.deepEqual(drillNextSteps(drill({ status: 'in_progress', effective_status: 'in_progress' }), NOW).map((n) => [n.key, n.go]), [['result', 'result']]);
  const open = drillNextSteps(drill({ status: 'completed', effective_status: 'completed', has_result: true, findings: [{ is_open: true }, { is_open: false }, { is_open: true }] as Drill['findings'] }), NOW);
  assert.deepEqual(open.map((n) => n.key), ['findings-open']);
  assert.equal(open[0].text, '2 findings are still open.');
  assert.deepEqual(drillNextSteps(drill({ status: 'completed', effective_status: 'completed', result: {} as Drill['result'] }), NOW).map((n) => n.key), ['close']);
  assert.deepEqual(drillNextSteps(drill({ status: 'closed', effective_status: 'closed', has_result: true }), NOW), []);
});

test('processes are listed most critical first, then by name; the address picks one of the plan\'s own', () => {
  const list = [bia(1, { process_name: 'Zeta', criticality_rating: 'low' }), bia(2, { process_name: 'Beta', criticality_rating: 'critical' }), bia(3, { process_name: 'Alpha', criticality_rating: 'critical' }), bia(4, { criticality_rating: 'odd' })];
  assert.deepEqual(orderedProcesses(list).map((b) => b.id), [3, 2, 1, 4]);
  assert.equal(openProcess(list, '2')?.id, 2);
  assert.equal(openProcess(list, '99'), null);
  assert.equal(openProcess(list, 'abc'), null);
  assert.equal(openProcess(list, '0'), null);
  assert.equal(openProcess(list, null), null);
});

test('a wide screen shows the list and a process (the first when none is asked for); a phone shows one or the other', () => {
  const list = [bia(1, { process_name: 'Zeta', criticality_rating: 'low' }), bia(2, { process_name: 'Beta', criticality_rating: 'critical' })];
  assert.deepEqual(masterDetail(false, list, null), { list: true, panel: list[1] });
  assert.deepEqual(masterDetail(false, list, '1'), { list: true, panel: list[0] });
  assert.deepEqual(masterDetail(true, list, null), { list: true, panel: null });
  assert.deepEqual(masterDetail(true, list, '1'), { list: false, panel: list[0] });
  assert.deepEqual(masterDetail(false, [], null), { list: true, panel: null });
});

test('editing a process sends everything but its linked assets, and asks before typing is lost', () => {
  const b = bia(5, { process_name: 'Settlement', rto_hours: 2, rpo_hours: null, mtpd_hours: 8, description: 'Daily run', linked_asset_ids: [3, 4] });
  const form = biaFormFrom(b);
  assert.deepEqual(form, { process_name: 'Settlement', criticality_rating: 'medium', rto_hours: '2', rpo_hours: '', mtpd_hours: '8', description: 'Daily run', linked_asset_ids: [3, 4] });
  assert.deepEqual(biaUpdatePayload({ ...form, rpo_hours: '1', description: '' }), { process_name: 'Settlement', criticality_rating: 'medium', description: null, rto_hours: 2, rpo_hours: 1, mtpd_hours: 8 });
  assert.equal(biaDirty(form, form), false);
  assert.equal(biaDirty({ ...form, process_name: 'Settlement run' }, form), true);
  assert.equal(biaDirty(blankBiaForm()), false, 'a new process with nothing typed asks nothing');
  assert.equal(biaDirty({ ...blankBiaForm(), linked_asset_ids: [1] }), true);
  assert.equal(biaDeleteWords({ process_name: 'Settlement', dependency_count: 1, strategy_count: 2 }).message, '“Settlement” will be deleted with its 1 dependency and 2 recovery strategies. A risk linked to it stays. This can\'t be undone.');
});
