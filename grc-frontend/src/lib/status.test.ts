// node --test "src/lib/status.test.ts"
// The status registry: the six tone families, the registry mechanism, and one table per Governance record, checked in both directions
// (every word of the table is registered; nothing is registered that the table does not list) and against the lists the backend writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { contrast } from './contrast.ts';
import { EMPTY } from './format.ts';
import {
  TONE, actionStatus, attestationStatus, committeeStatus, defineStatuses, departmentStatus, documentStatus, exceptionStatus, meetingStatus, norm, priority,
  rag, reviewStatus, statusPill, toneOf, type Statuses, type Tone,
} from './status.ts';
import { TONE as VENDOR_TONE, tones } from '../app/(dashboard)/vendor-risk/_ui/tones.ts';
import { STATUS_LABEL } from '../app/(dashboard)/governance/documents/_workspace/libraryModel.ts';

const FAMILIES: Tone[] = ['success', 'danger', 'warning', 'progress', 'pending', 'neutral'];

test('the six tone families have four #rrggbb colours and their words read on their tint (4.5:1)', () => {
  assert.deepEqual(Object.keys(TONE).sort(), FAMILIES.slice().sort());
  for (const name of FAMILIES) {
    const c = TONE[name];
    for (const hex of [c.dot, c.text, c.tint, c.border]) assert.match(hex, /^#[0-9A-F]{6}$/i, `${name} ${hex}`);
    assert.ok(contrast(c.text, c.tint) >= 4.5, `${name} words on tint: ${contrast(c.text, c.tint).toFixed(2)}`);
  }
});

test('the vendor kit reads the same tone model: one object, and its words still land where they did', () => {
  assert.equal(VENDOR_TONE, TONE);
  assert.equal(tones.lifecycle('under review'), 'progress');
  assert.equal(tones.finding('open'), 'danger');
  assert.equal(tones.lifecycle('constructor'), 'neutral');            // a word that is a property of every object is still just an unknown word
});

test('one word, however it is spelled; a word nobody registered is neutral', () => {
  assert.equal(norm(' Under-Review '), 'under_review');
  assert.equal(norm('UNDER   REVIEW'), 'under_review');
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
  const map: Record<string, Tone> = { under_review: 'progress' };
  assert.equal(toneOf(map, 'Under review'), 'progress');
  for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) assert.equal(toneOf(map, inherited), 'neutral', inherited);
  assert.equal(toneOf(map, ''), 'neutral');
  assert.equal(toneOf(map, null), 'neutral');
});

test('defineStatuses: tone, label, spellings, order', () => {
  const s = defineStatuses('demo', { draft: 'neutral', 'Pending Review': { tone: 'pending', label: 'In review' }, in_remediation: 'progress' });
  assert.equal(s.record, 'demo');
  assert.deepEqual(s.words, ['draft', 'pending_review', 'in_remediation']);       // written the way norm writes them, in the order given
  assert.equal(s.tone('PENDING-REVIEW'), 'pending');
  assert.equal(s.label('pending_review'), 'In review');                              // the label the record defined
  assert.equal(s.label('in_remediation'), 'In remediation');                         // else the readable form of the word
  assert.equal(s.has('Draft'), true);
  assert.equal(s.has('sent'), false);
  assert.equal(s.has('constructor'), false);
});

test('an unknown word is neutral with its own readable label, and none at all is the dash: never a guess', () => {
  const s = defineStatuses('demo', { draft: 'neutral' });
  assert.deepEqual(statusPill(s, 'awaiting_countersign'), { tone: 'neutral', label: 'Awaiting countersign' });
  assert.deepEqual(statusPill(s, 'Some-New State'), { tone: 'neutral', label: 'Some new state' });
  for (const none of [null, undefined, '', '   ']) assert.deepEqual(statusPill(s, none), { tone: 'neutral', label: EMPTY }, String(none));
  assert.equal(s.label('toString'), 'Tostring');
  assert.deepEqual(statusPill(documentStatus, 'published'), { tone: 'success', label: 'Published' });
});

test('defineStatuses refuses what would be a silent mistake: a repeated word, a blank word, a tone that does not exist', () => {
  assert.throws(() => defineStatuses('demo', { under_review: 'progress', 'Under review': 'pending' }), /same word/);
  assert.throws(() => defineStatuses('demo', { ' ': 'neutral' }), /blank/);
  assert.throws(() => defineStatuses('demo', { done: 'green' as unknown as Tone }), /no tone called "green"/);
  assert.throws(() => defineStatuses('demo', { done: { tone: 'toString' as unknown as Tone, label: 'Done' } }), /no tone/);
});

// ── the Governance records ────────────────────────────────────────────────────
type Row = [word: string, tone: Tone, label: string];

function exhaustive(statuses: Statuses, rows: Row[]): void {
  assert.deepEqual(statuses.words.slice().sort(), rows.map((r) => r[0]).sort(), `${statuses.record}: the words`);
  for (const [word, tone, label] of rows) {
    assert.equal(statuses.tone(word), tone, `${statuses.record} ${word}: tone`);
    assert.equal(statuses.label(word), label, `${statuses.record} ${word}: label`);
  }
}

test('documents: every status the server can write, in the library\'s own words', () => {
  exhaustive(documentStatus, [
    ['draft', 'neutral', 'Draft'], ['pending_review', 'pending', 'In review'], ['pending_approval', 'pending', 'In approval'],
    ['approved', 'progress', 'Approved'], ['published', 'success', 'Published'], ['expired', 'danger', 'Expired'],
    ['archived', 'neutral', 'Archived'], ['exception_applied', 'warning', 'Exception'], ['review_required', 'warning', 'Review required'],
  ]);
});

test('the library says the same words as the registry', () => {
  for (const [word, label] of Object.entries(STATUS_LABEL)) {
    assert.equal(documentStatus.has(word), true, `${word} is in the library but not the registry`);
    assert.equal(documentStatus.label(word), label, word);
  }
});

test('exceptions', () => {
  exhaustive(exceptionStatus, [
    ['draft', 'neutral', 'Draft'], ['pending_approval', 'pending', 'Pending approval'], ['approved', 'success', 'Approved'],
    ['rejected', 'danger', 'Rejected'], ['revoked', 'neutral', 'Revoked'], ['expired', 'danger', 'Expired'],
  ]);
});

test('committees, meetings and their actions', () => {
  exhaustive(committeeStatus, [['active', 'success', 'Active'], ['inactive', 'neutral', 'Inactive']]);
  exhaustive(meetingStatus, [
    ['scheduled', 'pending', 'Scheduled'], ['in_progress', 'progress', 'In progress'], ['completed', 'success', 'Completed'], ['cancelled', 'neutral', 'Cancelled'],
  ]);
  exhaustive(actionStatus, [
    ['open', 'pending', 'Open'], ['in_progress', 'progress', 'In progress'], ['completed', 'success', 'Completed'], ['overdue', 'danger', 'Overdue'],
  ]);
});

test('departments: the two words of a switched-on or switched-off department', () => {
  exhaustive(departmentStatus, [['active', 'success', 'Active'], ['inactive', 'neutral', 'Inactive']]);
  assert.deepEqual(statusPill(departmentStatus, 'inactive'), { tone: 'neutral', label: 'Inactive' });
});

test('review cycles, the review log and where a review date stands', () => {
  exhaustive(reviewStatus, [
    ['scheduled', 'pending', 'Scheduled'], ['in_progress', 'progress', 'In progress'], ['completed', 'success', 'Completed'], ['skipped', 'neutral', 'Skipped'],
    ['pending_review', 'pending', 'Pending review'], ['in_review', 'progress', 'In review'], ['approved', 'success', 'Approved'],
    ['rejected', 'danger', 'Rejected'], ['archived', 'neutral', 'Archived'],
    ['overdue', 'danger', 'Overdue'], ['due_soon', 'warning', 'Due soon'], ['on_track', 'success', 'On track'],     // where a review date stands today (the statistics' by_status)
  ]);
});

test('attestation campaigns, their requests and the attestations given', () => {
  exhaustive(attestationStatus, [
    ['draft', 'neutral', 'Draft'], ['active', 'progress', 'Active'], ['closed', 'neutral', 'Closed'], ['archived', 'neutral', 'Archived'],
    ['pending', 'pending', 'Pending'], ['completed', 'success', 'Completed'], ['overdue', 'danger', 'Overdue'], ['escalated', 'warning', 'Escalated'],
    ['revoked', 'neutral', 'Revoked'],
  ]);
});

test('the Governance priority scale: critical danger, high warning, medium progress, low neutral (the reviewer confirms)', () => {
  exhaustive(priority, [
    ['critical', 'danger', 'Critical'], ['high', 'warning', 'High'], ['medium', 'progress', 'Medium'], ['low', 'neutral', 'Low'], ['info', 'neutral', 'Info'],
  ]);
});

test('KPI / KRI rating: green on track, amber watch, red off target, and "not rated" where there is no rating (never "No data": a value can have no thresholds)', () => {
  exhaustive(rag, [['green', 'success', 'On track'], ['amber', 'warning', 'Watch'], ['red', 'danger', 'Off target'], ['unknown', 'neutral', 'Not rated']]);
  assert.deepEqual(statusPill(rag, undefined), { tone: 'neutral', label: EMPTY }, 'no word at all is the dash, as for every record');
});

// ── the backend's own lists ───────────────────────────────────────────────────
// A word the server starts writing fails here until someone decides its tone; the files are read when the backend is beside the frontend.
const BACKEND = new URL('../../../backend/grc/', import.meta.url);
const source = (path: string): string | null => {
  const url = new URL(path, BACKEND);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};
const present = (...paths: string[]): boolean => paths.every((p) => source(p) !== null);
const quoted = (text: string): string[] => Array.from(text.matchAll(/["']([a-z_]+)["']/g), (m) => m[1]);
/** the words of every python list or tuple written `name = [ ... ]` (or `( ... )`) */
const listed = (code: string, name: string): string[] =>
  Array.from(code.matchAll(new RegExp(`\\b${name}\\s*=\\s*[\\[(]([^\\])]*)[\\])]`, 'g')), (m) => quoted(m[1])).reduce((all, words) => all.concat(words), []);
/** the words of the comment after `status = Column(String(n), default="<first>")  # a, b, c` */
const commented = (code: string, column: string, first: string): string[] => {
  const m = new RegExp(`${column} = Column\\(String\\(\\d+\\), default="${first}"\\)\\s*#\\s*([a-z_, ]+)`).exec(code);
  return m ? m[1].split(',').map((w) => w.trim()).filter(Boolean) : [];
};

function covers(statuses: Statuses, declared: string[], where: string): void {
  assert.ok(declared.length > 0, `${where}: found no words to check (did the backend file change shape?)`);
  const missing = declared.filter((w) => !statuses.has(w));
  assert.deepEqual(missing, [], `${where}: the server can write ${missing.join(', ')}; register ${missing.length > 1 ? 'them' : 'it'} in ${statuses.record} (src/lib/status.ts)`);
}

test('documents: the lists the backend validates and filters on are all registered',
  { skip: !present('models/_13_governance_document_management_enhanced.py', 'modules/governance/routers/documents.py', 'modules/governance/permissions.py') }, () => {
  const model = source('models/_13_governance_document_management_enhanced.py')!;
  covers(documentStatus, commented(model, 'status', 'draft'), 'models/_13 GovernanceDocument.status');
  const routes = source('modules/governance/routers/documents.py')!;
  covers(documentStatus, listed(routes, 'valid_statuses'), 'routers/documents.py valid_statuses');
  const rights = source('modules/governance/permissions.py')!;
  covers(documentStatus, listed(rights, 'ON_ITS_WAY').concat(listed(rights, 'LAPSED')), 'governance/permissions.py ON_ITS_WAY / LAPSED');
});

test('exceptions: every status the router assigns is registered', { skip: !present('routers/policy_exception_router.py') }, () => {
  const router = source('routers/policy_exception_router.py')!;
  const assigned = Array.from(router.matchAll(/\bexception\.status = "([a-z_]+)"/g), (m) => m[1]).concat(listed(router, '_EDITABLE'), ['draft']);
  covers(exceptionStatus, assigned, 'routers/policy_exception_router.py');
});

test('committees, reviews, attestations and priorities: the words in the models\' comments are all registered',
  { skip: !present('models/_29_board_committee_management_models.py', 'models/_13_governance_document_management_enhanced.py', 'models/_27_attestation_certification_management_models.py') }, () => {
  const committees = source('models/_29_board_committee_management_models.py')!;
  covers(meetingStatus, commented(committees, 'status', 'scheduled'), 'models/_29 CommitteeMeeting.status');
  covers(actionStatus, commented(committees, 'status', 'open'), 'models/_29 OversightAction.status');
  const scale = /#\s*((?:[a-z]+ \/ )+[a-z]+):\s*sets the SLA days/.exec(committees);
  covers(priority, scale ? scale[1].split(' / ') : [], 'models/_29 OversightAction.priority');
  const governance = source('models/_13_governance_document_management_enhanced.py')!;
  covers(reviewStatus, commented(governance, 'review_status', 'scheduled'), 'models/_13 PolicyReviewHistory.review_status');
  covers(reviewStatus, commented(governance, 'review_status', 'pending_review'), 'models/_13 GovernanceActionReview.review_status');
  const attestations = source('models/_27_attestation_certification_management_models.py')!;
  covers(attestationStatus, commented(attestations, 'status', 'draft'), 'models/_27 AttestationCampaign.status');
  covers(attestationStatus, commented(attestations, 'status', 'pending'), 'models/_27 AttestationRequest.status');
});

test('KPI / KRI rating: every rating the server can give is registered', { skip: !present('modules/erm/routers/kris.py') }, () => {
  const router = source('modules/erm/routers/kris.py')!;
  const rating = /def calculate_kri_status[\s\S]*?\r?\n\r?\n\r?\ndef /.exec(router)?.[0] ?? '';
  covers(rag, Array.from(rating.matchAll(/return "([a-z]+)"/g), (m) => m[1]), 'modules/erm/routers/kris.py calculate_kri_status');
});
