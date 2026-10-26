// node --test "src/app/(dashboard)/governance/documents/attestation/_logic.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coverageColour, coverageOf, countLabel, filterCampaigns, fmtDate, fmtWhen, ownName, plural,
  type CoverageSource,
} from './_logic.ts';

const TITLE = 'Information Security Policy';
// the title the name is compared with: TITLE unless given; null is a document with no title (undefined would pick the default)
const own = (name: string, title: string | null = TITLE) => ownName({ name, document_title: title ?? undefined });

// ── the name a row shows ──────────────────────────────────────────────────────────────────────────────────────────────────

test('a campaign named after its document says nothing of its own: the row shows the title once', () => {
  assert.equal(own(`Attestation — ${TITLE}`), '');                  // what the server names a campaign when it is given no name
  assert.equal(own(`${TITLE} - acknowledgement`), '');
  assert.equal(own(`${TITLE} - Acknowledgment`), '');               // the other spelling, any case
  assert.equal(own(`Acknowledgment of ${TITLE}`), '');
  assert.equal(own(`Attestation for ${TITLE}`), '');
  assert.equal(own(`attestation: ${TITLE.toUpperCase()}`), '');
  assert.equal(own(TITLE), '');
  assert.equal(own(`  ${TITLE}  `), '');
});

test('nothing, or only the generic words, is not a name either', () => {
  assert.equal(own(''), '');
  assert.equal(own('   '), '');
  assert.equal(own('Attestation'), '');
  assert.equal(own('Attestation — acknowledgement'), '');
  assert.equal(own('Attestation', null), '');                       // a document with no title: the generic words are still generic
});

test('a name that says more than "attestation of the document" is kept, as it was typed (trimmed)', () => {
  assert.equal(own('Q3 policy acknowledgment'), 'Q3 policy acknowledgment');
  assert.equal(own(`${TITLE} Q3`), `${TITLE} Q3`);
  assert.equal(own(`Attestation — ${TITLE} (staff only)`), `Attestation — ${TITLE} (staff only)`);
  assert.equal(own('  Q3 rollout  '), 'Q3 rollout');
  assert.equal(own('Attestation — Data Retention Policy'), 'Attestation — Data Retention Policy');     // another document's name is not this one's
  assert.equal(own('Attestation — Q3', null), 'Attestation — Q3');
});

test('a name in Arabic (or any script without Latin letters) is never mistaken for a repeat', () => {
  assert.equal(own('إقرار السياسة'), 'إقرار السياسة');
  assert.equal(own('确认 2026'), '确认 2026');
});

// ── coverage ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const src = (over: Partial<CoverageSource> = {}): CoverageSource => ({
  attestation_percent: 83, acknowledgment_count: 10, active_domain_users: 12, allowed_email_domain: 'example.com', ...over,
});

test('coverage is a bar, "83% · 10/12", and the same in words for a screen reader and the tooltip', () => {
  assert.deepEqual(coverageOf(src()), {
    pct: 83,
    width: 83,
    colour: '#d97706',
    text: '83% · 10/12',
    words: '83% acknowledged: 10 of 12 active users on @example.com',
  });
});

test('coverage that is not measured (no active user on the campaign\'s email domain) is not drawn at all', () => {
  assert.equal(coverageOf(src({ attestation_percent: null, active_domain_users: 0 })), null);
});

test('without the number of people it is out of, only the percent is said', () => {
  const view = coverageOf(src({ attestation_percent: 50, acknowledgment_count: 4, active_domain_users: undefined, allowed_email_domain: null }));
  assert.equal(view?.text, '50%');
  assert.equal(view?.words, '50% acknowledged');
  assert.equal(coverageOf(src({ active_domain_users: undefined }))?.words, '83% acknowledged on @example.com');
});

test('the email domain is named only when the campaign has one', () => {
  assert.equal(coverageOf(src({ allowed_email_domain: null }))?.words, '83% acknowledged: 10 of 12 active users');
  assert.equal(coverageOf(src({ allowed_email_domain: '' }))?.words, '83% acknowledged: 10 of 12 active users');
});

test('no one yet is 0% and an empty bar; everyone is 100% and a full one', () => {
  assert.deepEqual(coverageOf(src({ attestation_percent: 0, acknowledgment_count: 0 })), {
    pct: 0, width: 0, colour: '#e11d48', text: '0% · 0/12', words: '0% acknowledged: 0 of 12 active users on @example.com',
  });
  const all = coverageOf(src({ attestation_percent: 100, acknowledgment_count: 12 }));
  assert.equal(all?.width, 100);
  assert.equal(all?.colour, '#059669');
});

test('a count the server left out reads as none; a percent outside 0 to 100 never draws outside the bar', () => {
  assert.equal(coverageOf(src({ attestation_percent: 0, acknowledgment_count: undefined as unknown as number }))?.text, '0% · 0/12');
  assert.equal(coverageOf(src({ attestation_percent: 140 }))?.width, 100);
  assert.equal(coverageOf(src({ attestation_percent: 140 }))?.text, '140% · 10/12');      // the number is said as it is; only the bar is held in
  assert.equal(coverageOf(src({ attestation_percent: -5 }))?.width, 0);
});

test('the bar is green from 90, amber from 70, red below (the library\'s attestation ring)', () => {
  assert.deepEqual([100, 90, 89, 70, 69, 0].map(coverageColour), ['#059669', '#059669', '#d97706', '#d97706', '#e11d48', '#e11d48']);
});

// ── search and counts ─────────────────────────────────────────────────────────────────────────────────────────────────────

const campaigns = [
  { id: 1, name: `Attestation — ${TITLE}`, document_title: TITLE },
  { id: 2, name: 'Q3 acknowledgment', document_title: 'Acceptable Use Policy' },
  { id: 3, name: 'Vendor onboarding', document_title: undefined },
];
const ids = (rows: { id: number }[]) => rows.map((r) => r.id).join(',');

test('a search keeps the campaigns with the words in the name or in the document\'s title, in any case, and ignores spaces around them', () => {
  assert.equal(ids(filterCampaigns(campaigns, 'acceptable')), '2');           // only the document's title says it
  assert.equal(ids(filterCampaigns(campaigns, 'Q3')), '2');
  assert.equal(ids(filterCampaigns(campaigns, 'q3')), '2');
  assert.equal(ids(filterCampaigns(campaigns, '  SECURITY  ')), '1');
  assert.equal(ids(filterCampaigns(campaigns, 'vendor')), '3');               // a campaign whose document has no title
  assert.equal(ids(filterCampaigns(campaigns, 'policy')), '1,2');
  assert.deepEqual(filterCampaigns(campaigns, 'nothing like this'), []);
});

test('a blank search keeps every campaign, as the very same list', () => {
  assert.equal(filterCampaigns(campaigns, ''), campaigns);
  assert.equal(filterCampaigns(campaigns, '   '), campaigns);
});

test('the count says how many campaigns there are, and how many of them while a search narrows the list', () => {
  assert.equal(plural(9), '9 campaigns');
  assert.equal(plural(1), '1 campaign');
  assert.equal(plural(0), '0 campaigns');
  assert.equal(countLabel(9, 9, false), '9 campaigns');
  assert.equal(countLabel(1, 1, false), '1 campaign');
  assert.equal(countLabel(3, 9, true), '3 of 9 campaigns');
  assert.equal(countLabel(0, 9, true), '0 of 9 campaigns');
  assert.equal(countLabel(1, 1, true), '1 of 1 campaign');
});

// ── times ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a due date reads "08 Nov 2026", on the day it was set, whatever zone the viewer is in', () => {
  assert.equal(fmtDate('2026-11-08'), '08 Nov 2026');
  assert.equal(fmtDate('2026-11-08T00:00:00'), '08 Nov 2026');               // the server's time has no zone and is UTC, not local
  assert.equal(fmtDate('2026-11-08T23:30:00Z'), '08 Nov 2026');
  assert.equal(fmtDate('2026-01-02T00:00:00+05:00'), '01 Jan 2026');          // a time that names its zone is honoured
});

test('no date, or one that is not a date, reads as a dash', () => {
  for (const none of [null, undefined, '', 'not a date']) {
    assert.equal(fmtDate(none), '—');
    assert.equal(fmtWhen(none), '—');
  }
});

test('the time somebody signed is said in the viewer\'s own locale and zone: a real time reads as something, and two times differ', () => {
  const at = fmtWhen('2026-11-18T12:00:00');
  assert.notEqual(at, '—');
  assert.notEqual(at, fmtWhen('2026-11-18T13:00:00'));
  assert.notEqual(at, fmtWhen('2026-11-19T12:00:00'));
});
