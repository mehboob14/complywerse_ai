// node --test "src/app/(dashboard)/my-work/workModel.test.ts"
// The rules of My Work moved out of the page: the person's controls, the ranking of the journey items, a framework's progress and the "This week" counts are what the old page computed
// (frozen copies of its code are compared on the same data), and the control-plane rules (code, title, overdue) say what they said.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY, failedNames, frameworksOf, isDone, mineOf, scfCode, scfOverdue, scfTitle, weekOf, workItems, type Ctrl, type Journey, type Per } from './workModel.ts';

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const ME = 7;

const DONE_OLD = new Set(['verified', 'implemented', 'not_applicable']);

/** the old page's `items` memo */
function oldItems(per: Per[], now: number) {
  const out: Array<Record<string, unknown>> = [];
  per.forEach(({ journey, mine }) => {
    const due = journey.target_date ? new Date(journey.target_date).getTime() : null;
    mine.forEach((c) => {
      const done = DONE_OLD.has(c.status || '');
      out.push({
        journeyId: journey.id, frameworkName: journey.framework_name || journey.name || 'Framework', controlId: c.id, code: c.control_code || '', title: c.control_name || c.title || '(untitled)',
        status: c.status || 'not_started', isCritical: !!c.is_critical, approved: c.approved_evidence_count || 0, required: c.required_evidence_count || c.evidence_count || 0,
        due, done, overdue: !!due && due < now && !done, active: c.status === 'in_review' || c.status === 'in_progress',
      });
    });
  });
  const rank = (i: Record<string, unknown>) => (i.done ? 4000 : 0) + (i.overdue ? 0 : 1000) + (i.isCritical ? 0 : 100) + (i.active ? 0 : 10);
  out.sort((a, b) => rank(a) - rank(b) || ((a.due as number) || Infinity) - ((b.due as number) || Infinity));
  return out;
}

/** the old page's `frameworks` memo */
function oldFrameworks(per: Per[]) {
  return per.map(({ journey, mine }) => {
    const prog = (journey.progress || {}) as Record<string, number>;
    const pct = Math.round((prog.compliance_percentage ?? prog.readiness_percentage ?? prog.percentage ?? (mine.length ? (100 * mine.filter((m) => DONE_OLD.has(m.status || '')).length) / mine.length : 0)) as number);
    return { id: journey.id, name: journey.framework_name || journey.name || 'Framework', pct, myCount: mine.length, phase: journey.current_phase, status: journey.status };
  }).filter((f) => f.myCount > 0);
}

/** the old page's `week` memo */
function oldWeek(per: Per[], items: Array<Record<string, unknown>>, now: number) {
  const all = per.flatMap((p) => p.mine);
  return {
    completed: all.filter((c) => c.verified_date && (now - new Date(c.verified_date).getTime()) < 7 * DAY).length,
    evidenceApproved: all.reduce((s, c) => s + (c.approved_evidence_count || 0), 0),
    awaitingReviewer: all.filter((c) => c.status === 'in_review').length,
    dueNext7: items.filter((i) => !i.done && i.due != null && (i.due as number) - now < 7 * DAY && (i.due as number) - now > -DAY).length,
  };
}

const iso = (days: number) => new Date(NOW + days * DAY).toISOString();
const journeys: Journey[] = [
  { id: 1, framework_name: 'ISO 27001', target_date: iso(-10), current_phase: 2, status: 'active', progress: { compliance_percentage: 41.6 } },
  { id: 2, name: 'SOC 2', target_date: iso(3), progress: { readiness_percentage: 70 } },
  { id: 3, framework_name: 'PCI', target_date: null, progress: {} },
  { id: 4, framework_name: 'NCA', target_date: iso(30) },
  { id: 5, framework_name: 'Nothing of mine', target_date: iso(5) },
];
const controls: Record<number, Ctrl[]> = {
  1: [
    { id: 11, control_code: 'A.5.1', control_name: 'Policies', status: 'in_progress', is_critical: true, assigned_user_ids: [ME], approved_evidence_count: 2, required_evidence_count: 4 },
    { id: 12, control_code: 'A.5.2', title: 'Roles', status: 'verified', assigned_to_user_id: ME, verified_date: iso(-2), approved_evidence_count: 3, evidence_count: 3 },
    { id: 13, status: 'not_started', assigned_user_ids: [ME, 9] },
    { id: 14, status: 'in_review', assigned_user_ids: [9] },
  ],
  2: [{ id: 21, control_code: 'CC1', control_name: 'Control env', status: 'in_review', assigned_user_ids: [ME] }, { id: 22, control_code: 'CC2', status: 'implemented', assigned_user_ids: [ME], verified_date: iso(-30) }],
  3: [{ id: 31, control_code: 'P1', control_name: 'PAN', status: 'not_started', assigned_to_user_id: ME, is_critical: true }],
  4: [{ id: 41, control_code: 'N1', status: 'not_applicable', assigned_user_ids: [ME] }, { id: 42, control_code: 'N2', status: 'in_progress', assigned_user_ids: [ME] }],
  5: [{ id: 51, assigned_user_ids: [3] }],
};
const per: Per[] = journeys.map((journey) => ({ journey, mine: mineOf(controls[journey.id], ME), total: controls[journey.id].length }));

test('the person\'s controls: in the assigned list, or the single assignee', () => {
  assert.deepEqual(mineOf(controls[1], ME).map((c) => c.id), [11, 12, 13]);
  assert.deepEqual(mineOf(controls[5], ME), []);
  assert.deepEqual(mineOf([], ME), []);
});

test('the journey items are ranked as the old page ranked them: done last, overdue first, critical first, in progress first, then the earliest due', () => {
  assert.deepEqual(workItems(per, NOW), oldItems(per, NOW));
  const items = workItems(per, NOW);
  assert.equal(items.length, 8);
  assert.deepEqual(items.map((i) => i.controlId), oldItems(per, NOW).map((i) => i.controlId));
  assert.ok(items[items.length - 1].done, 'a done item is last');
  assert.equal(items[0].overdue, true, 'overdue first');
  for (const later of [NOW + DAY, NOW + 40 * DAY]) assert.deepEqual(workItems(per, later), oldItems(per, later), `at another time (${later})`);
});

test('a framework\'s progress is its own percentage (compliance, readiness, plain), else the share of the person\'s controls that are done; frameworks with nothing of theirs are left out', () => {
  assert.deepEqual(frameworksOf(per), oldFrameworks(per));
  const rows = frameworksOf(per);
  assert.deepEqual(rows.map((r) => [r.id, r.pct, r.myCount]), [[1, 42, 3], [2, 70, 2], [3, 0, 1], [4, 50, 2]]);
});

test('"This week": verified in the last seven days, evidence approved, waiting for a reviewer, due in the next seven days', () => {
  const items = workItems(per, NOW);
  assert.deepEqual(weekOf(per, items, NOW), oldWeek(per, oldItems(per, NOW), NOW));
  assert.deepEqual(weekOf(per, items, NOW), { completed: 1, evidenceApproved: 5, awaitingReviewer: 1, dueNext7: 1 });
});

test('done means verified, implemented or not applicable, and nothing else', () => {
  for (const s of ['verified', 'implemented', 'not_applicable']) assert.equal(isDone(s), true, s);
  for (const s of ['in_review', 'in_progress', 'not_started', '', undefined]) assert.equal(isDone(s as string | undefined), false, String(s));
});

test('a control-plane item: its code, its title (else the code, else untitled) and whether it is overdue', () => {
  assert.equal(scfCode({ scf_id: 'GOV-01', control_id: 'x' } as never), 'GOV-01');
  assert.equal(scfCode({ control_id: 'x' } as never), 'x');
  assert.equal(scfTitle({ title: 'T', scf_id: 'GOV-01' } as never), 'T');
  assert.equal(scfTitle({ scf_id: 'GOV-01' } as never), 'GOV-01');
  assert.equal(scfTitle({} as never), '(untitled)');
  assert.equal(scfOverdue({ next_due_at: iso(-1) } as never, NOW), true);
  assert.equal(scfOverdue({ next_due_at: iso(1) } as never, NOW), false);
  assert.equal(scfOverdue({} as never, NOW), false);
});

test('a framework whose controls could not be read is named, not counted as "nothing assigned"', () => {
  const broken: Per[] = [{ journey: { id: 1, framework_name: 'ISO' }, mine: [], total: 0, failed: true }, { journey: { id: 2 }, mine: [], total: 0, failed: true }, { journey: { id: 3, name: 'OK' }, mine: [], total: 0 }];
  assert.deepEqual(failedNames(broken), ['ISO', 'Framework 2']);
  assert.deepEqual(failedNames(per), []);
});
