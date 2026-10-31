// node --test "src/app/(dashboard)/governance/documents/attestation/attestationPage.test.ts"
// What the Attestation page promises and a screenshot cannot hold for long (source-text tests, like settingsPage.test.ts): it is on the design-system kit,
// closing and creating a campaign are reported by useReportedMutation and go to the endpoints they always did, a campaign is closed only after a question,
// the coverage rule and the sealed signatures are untouched, acknowledgements are never counted with approvals, and the page never claims a total it does not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';
import { routeFor } from '../../../../../lib/navRegistry.ts';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.tsx$/.test(f));
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');
const src = Object.fromEntries(files.map((f) => [f, read(f)])) as Record<string, string>;
const all = files.map((f) => src[f]).join('\n');
const page = src['page.tsx'];

test('the page is made of the files this test knows about', () => {
  assert.deepEqual(files.sort(), ['_CampaignDetail.tsx', '_Coverage.tsx', '_CreateCampaign.tsx', 'page.tsx']);
});

test('the head is the kit\'s PageHeader with the registry\'s name for the page, and nothing of the legacy scope or head is left', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title="Attestation"/);
  assert.equal(routeFor('/governance/documents/attestation')?.label, 'Attestation');
  assert.doesNotMatch(all, /DocPageHeader|docUi|PageLoader|governance-light|RowActionsMenu/);
});

test('no file of the page uses a class the platform CSS rewrites, a hex colour, or a bare form control (kit rules)', () => {
  for (const f of files) {
    assert.deepEqual(findViolations(src[f]), [], f);
    assert.doesNotMatch(src[f], /#[0-9a-fA-F]{6}\b/, `${f}: colours are the --ds tokens`);
    assert.doesNotMatch(src[f], /<(select|textarea|input)\b/, `${f}: the kit's Select, Textarea and TextInput`);
  }
  assert.equal((page.match(/<button\b/g) ?? []).length, 1);                              // the clear-search cross
  assert.equal((src['_CampaignDetail.tsx'].match(/<button\b/g) ?? []).length, 1);        // the signature thumbnail that opens the preview
});

test('no native dialog: closing a campaign asks with the kit dialog, and says what it does', () => {
  assert.doesNotMatch(all, /window\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(|(?<!await )(?<![.\w])confirm\(/);
  assert.match(page, /confirm\(\{ title: 'Close this attestation\?', message: CLOSE_NOTE, confirmLabel: 'Close campaign', tone: 'danger' \}\)/);
  assert.match(page, /Every signed acknowledgement is kept\./);
});

test('closing and creating a campaign are reported by useReportedMutation, to the same endpoints; creating is never offered a Retry', () => {
  assert.doesNotMatch(all, /\buseMutation\(/);
  assert.equal((all.match(/useReportedMutation\(\{/g) ?? []).length, 2);
  assert.match(page, /updateDocAttestationCampaign\(id, \{ status: 'closed' \}\)/);
  assert.match(src['_CreateCampaign.tsx'], /createDocAttestationCampaign\(\{/);
  assert.match(src['_CreateCampaign.tsx'], /due_date: dueDate \? new Date\(dueDate\)\.toISOString\(\) : undefined,\s*activate: true,/);        // what is sent is what was sent
  assert.match(src['_CreateCampaign.tsx'], /failure: 'Not created',\s*retryable: false/);
  assert.doesNotMatch(all, /\btoast\(/);
});

test('the same query keys as before, and a close refreshes what it always did', () => {
  for (const key of ["'doc-attest-campaigns'", "'gov-docs-published-attest'", "'doc-attest-campaign', id"]) assert.ok(all.includes(key), key);
  assert.match(page, /invalidate: \[\['doc-attest-campaigns'\], \['gov-docs-coverage'\]\]/);
  assert.match(src['_CreateCampaign.tsx'], /invalidate: \[\['doc-attest-campaigns'\], \['gov-docs-coverage'\]\]/);
  for (const call of ['listDocAttestationCampaigns()', 'getDocAttestationCampaign(id)']) assert.ok(all.includes(`governanceApi.${call}`), call);
  assert.match(page, /getDocuments\(\{ status: 'published', limit: 500 \}/);
});

test('the campaign list carries no total, so the page never says how many there are: it says "cut" and what that means', () => {
  assert.match(page, /isCut\(campaigns\.length\)/);
  assert.match(page, /cutNotice\(campaigns\.length\)/);
  assert.match(page, /countLabel\(matches\.length, campaigns\.length, searching, cut\)/);
  assert.doesNotMatch(page, /\.count\b|data\.count/);                                    // the server's `count` is only the length of what it sent
});

test('the coverage rule and the sealed signatures are the server\'s and the shared component\'s, untouched', () => {
  assert.match(src['_Coverage.tsx'], /coverageOf\(c\)/);
  assert.match(src['_Coverage.tsx'], /role="img" aria-label=\{view\.words\}/);
  assert.match(src['_CampaignDetail.tsx'], /import SignatureSeal from '@\/components\/governance\/SignatureSeal'/);
  assert.match(src['_CampaignDetail.tsx'], /<SignatureSeal id=\{a\.esign_id\} fingerprint=\{a\.esign_fingerprint\}/);
  assert.match(src['_CampaignDetail.tsx'], /campaign\?\.public_url \|\| \(campaign \? `\/attest\/\$\{campaign\.public_token\}` : ''\)/);          // the link people sign through
});

test('acknowledgements are acknowledgements: nothing here reads or counts approvals', () => {
  const code = all.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');                  // (the comments say it too)
  assert.doesNotMatch(code, /approval|lifecycle|my-pending|signoff|assessments/i);
});

test('a campaign\'s acknowledgements are shown a page at a time (800 arrive at once), counted by the server\'s number', () => {
  const d = src['_CampaignDetail.tsx'];
  assert.match(d, /pageOf\(acks, page, size\)/);
  assert.match(d, /campaign\.acknowledgment_count \?\? acks\.length/);
  assert.match(d, /<Pager /);
});

test('a due date is a day and a signing time is a moment, said by the helpers, never formatted by hand', () => {
  const noPayload = files.filter((f) => f !== '_CreateCampaign.tsx').map((f) => src[f]).join('\n');
  assert.doesNotMatch(noPayload, /toLocale(Date|Time)?String|new Date\(|toISOString|Intl\.DateTimeFormat/);
  assert.match(page, /dayText\(c\.due_date\)/);
  assert.match(src['_CampaignDetail.tsx'], /momentText\(a\.acknowledged_at\)/);
});

test('the legacy attestation pages and the public sign page are not part of this page', () => {
  assert.doesNotMatch(all, /governance\/attestations|attestation-campaigns|\/attest\/\[token\]/);
});

test('the sealed signature is drawn in the design-system tokens here (an optional `ds` prop) and exactly as it always was for the other two screens that use it', () => {
  const seal = readFileSync(new URL('../../../../../components/governance/SignatureSeal.tsx', import.meta.url), 'utf8');
  assert.match(src['_CampaignDetail.tsx'], /<SignatureSeal id=\{a\.esign_id\} fingerprint=\{a\.esign_fingerprint\} thumb=\{false\} ds \/>/);
  assert.match(seal, /ds = false/);                                                       // off unless asked for
  assert.match(seal, /<div className="min-w-0 text-\[11px\] text-slate-500">/);            // the legacy markup is still there, untouched
  assert.match(seal, /className="font-medium text-primary-700 hover:underline disabled:opacity-50"/);
  assert.match(seal, /esignApi\.get\(id\)/);                                              // and Verify still checks the seal through the same call
});
