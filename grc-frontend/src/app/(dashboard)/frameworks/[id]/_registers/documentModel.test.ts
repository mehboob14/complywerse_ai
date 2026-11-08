// node --test "src/app/(dashboard)/frameworks/\[id\]/_registers/documentModel.test.ts"
// The framework document editor's pure rules: where a section stands, the progress line, the text tools, the table edits, the AI draft merged in,
// the workflow guard, and the Markdown that is downloaded and published.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NEW_SECTION, addTableRow, bulletLines, canSendForReview, clampIndex, countsLine, downloadName, govDocType, hasPlaceholder, mergeDraft, nextStep,
  openAfterRemove, patchSection, publishBody, removeTableRow, saveBody, sectionCounts, sectionHasContent, sectionState, setTableCell, toMarkdown, wordCount,
  wrapSelection, type DocSection, type FrameworkDoc,
} from './documentModel.ts';

const doc = (over: Partial<FrameworkDoc> = {}): FrameworkDoc => ({
  id: 4, doc_type: 'isms_scope_statement', title: 'ISMS Scope Statement', control_ref: 'ISO/IEC 27001:2022 Cl. 4.3', organization: 'Acme', owner_id: 3, owner_name: 'A',
  classification: 'internal', version: '1.0', approved_by: null, approval_date: null, effective_date: '2026-11-08', next_review_date: null, status: 'draft',
  reviewer_id: null, approver_id: null, submitted_for_review_at: null, sections: [], ...over,
});
const sec = (over: Partial<DocSection> = {}): DocSection => ({ heading: 'Purpose', body: '', ...over });

test('a section stands where it says, else where its text puts it', () => {
  assert.equal(sectionState(sec({ status: 'ready' })), 'ready');
  assert.equal(sectionState(sec({ status: 'to_start', body: 'text' })), 'to_start', 'its own word wins');
  assert.equal(sectionState(sec()), 'to_start');
  assert.equal(sectionState(sec({ body: '  ' })), 'to_start');
  assert.equal(sectionState(sec({ body: 'x' })), 'draft');
  assert.equal(sectionState(sec({ table: { columns: ['a'], rows: [['1']] } })), 'draft');
  assert.equal(sectionState(sec({ table: { columns: ['a'], rows: [] } })), 'to_start');
});

test('the progress line counts the three words', () => {
  const s = [sec({ status: 'ready' }), sec({ body: 'x' }), sec(), sec({ status: 'ready' })];
  assert.deepEqual(sectionCounts(s), { ready: 2, draft: 1, to_start: 1 });
  assert.equal(countsLine(s), '2 ready · 1 draft · 1 to start');
  assert.equal(countsLine([]), '0 ready · 0 draft · 0 to start');
});

test('words are counted by spaces, a placeholder is a short [bracket], and removing a section is a loss only when it holds text', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('  one  two\nthree '), 3);
  assert.equal(hasPlaceholder('Owner: [Company Name]'), true);
  assert.equal(hasPlaceholder('see [a very long bracket that goes on and on and on and on and on and on]'), false);
  assert.equal(hasPlaceholder('no brackets'), false);
  assert.equal(sectionHasContent(sec()), false);
  assert.equal(sectionHasContent(sec({ body: 'x' })), true);
  assert.equal(sectionHasContent(sec({ table: { columns: ['a'], rows: [['', ' ']] } })), false);
  assert.equal(sectionHasContent(sec({ table: { columns: ['a'], rows: [['x']] } })), true);
});

test('a document is published as the governance type its name says', () => {
  assert.equal(govDocType({ doc_type: 'x', title: 'Incident Response Procedure' }), 'procedure');
  assert.equal(govDocType({ doc_type: 'x', title: 'Cryptography Standard' }), 'standard');
  assert.equal(govDocType({ doc_type: 'x', title: 'Style guide' }), 'guideline');
  assert.equal(govDocType({ doc_type: 'incident_response_plan', title: null }), 'procedure');
  assert.equal(govDocType({ doc_type: 'x', title: 'Access Control Policy' }), 'policy');
});

test('the one workflow button: a draft goes for review, one in review is approved, an approved one has no next step', () => {
  assert.deepEqual(nextStep('draft'), { to: 'in_review', label: 'Send for review' });
  assert.deepEqual(nextStep(null), { to: 'in_review', label: 'Send for review' });
  assert.deepEqual(nextStep('in_review'), { to: 'approved', label: 'Approve' });
  assert.equal(nextStep('approved'), null);
  assert.equal(canSendForReview({ reviewer_id: 1, approver_id: 2 }), true);
  assert.equal(canSendForReview({ reviewer_id: 1, approver_id: null }), false);
  assert.equal(canSendForReview({ reviewer_id: null, approver_id: 2 }), false);
});

test('a save sends the details and the sections, and nothing the page does not own', () => {
  const body = saveBody(doc({ sections: [sec()] }));
  assert.deepEqual(Object.keys(body).sort(), ['approval_date', 'approved_by', 'approver_id', 'classification', 'effective_date', 'next_review_date', 'organization', 'owner_id', 'owner_name',
    'reviewer_id', 'sections', 'status', 'title', 'version']);
  assert.equal('id' in body, false);
  assert.equal('doc_type' in body, false);
});

test('editing sections never changes the list it was given', () => {
  const t: DocSection = { heading: 'Register', body: '', table: { columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']] } };
  const list = [sec(), t];
  assert.equal(patchSection(list, 0, { heading: 'Aim' })[0].heading, 'Aim');
  assert.equal(list[0].heading, 'Purpose');
  const edited = setTableCell(list, 1, 1, 0, 'x');
  assert.deepEqual(edited[1].table?.rows, [['1', '2'], ['x', '4']]);
  assert.deepEqual(t.table?.rows, [['1', '2'], ['3', '4']]);
  assert.equal(setTableCell(list, 0, 0, 0, 'x')[0], list[0], 'a section with no table is left as it is');
  assert.deepEqual(addTableRow(list, 1)[1].table?.rows.at(-1), ['', '']);
  assert.equal(addTableRow(list, 0)[0].table, undefined);
  assert.deepEqual(removeTableRow(list, 1, 0)[1].table?.rows, [['3', '4']]);
  assert.equal(NEW_SECTION.status, 'to_start');
});

test('the open section stays inside the list: after a removal the one before it, never below the first', () => {
  assert.equal(openAfterRemove(3, 3), 2);
  assert.equal(openAfterRemove(3, 1), 2);
  assert.equal(openAfterRemove(1, 3), 1);
  assert.equal(openAfterRemove(0, 0), 0);
  assert.equal(clampIndex(5, 3), 2);
  assert.equal(clampIndex(-1, 3), 0);
  assert.equal(clampIndex(0, 0), 0);
});

test('an AI draft fills the text of the sections it drafted, only the asked one when there is a target, and never a table', () => {
  const s = [sec({ heading: 'A', body: 'old a' }), sec({ heading: 'B', body: 'old b' }), sec({ heading: 'T', body: 'old t', table: { columns: ['x'], rows: [] } }), sec({ heading: 'C', body: 'old c' })];
  const drafted = [{ heading: 'A', body: 'new a' }, { heading: 'B', body: '' }, { heading: 'T', body: 'new t' }];
  const all = mergeDraft(s, drafted);
  assert.deepEqual(all.map((x) => x.body), ['new a', 'old b', 'old t', 'old c'], 'an empty draft keeps the text; a table is not overwritten; an undrafted section is kept');
  assert.deepEqual(mergeDraft(s, drafted, 'A').map((x) => x.body), ['new a', 'old b', 'old t', 'old c']);
  assert.deepEqual(mergeDraft(s, [{ heading: 'A', body: 'new a' }, { heading: 'C', body: 'new c' }], 'C').map((x) => x.body), ['old a', 'old b', 'old t', 'new c']);
  assert.equal(s[0].body, 'old a');
});

test('bold, italic and link wrap the selection, or the word "text"; bullets start every line of the selection', () => {
  assert.deepEqual(wrapSelection('say hello now', 4, 9, '**', '**'), { text: 'say **hello** now', selStart: 6, selEnd: 11 });
  assert.deepEqual(wrapSelection('abc', 1, 1, '*', '*'), { text: 'a*text*bc', selStart: 2, selEnd: 6 });
  assert.equal(wrapSelection('a', 0, 1, '[', '](https://)').text, '[a](https://)');
  const b = bulletLines('one\ntwo\n\nthree', 2, 9);
  assert.equal(b.text, '- one\n- two\n\nthree');
  assert.equal(bulletLines('- done\nnext', 0, 11).text, '- done\n- next');
  assert.equal(bulletLines('', 0, 0).text, '- item');
  assert.equal(bulletLines('a\nb', 3, 3).text, 'a\n- b', 'a cursor at the end of the text bullets its own line');
});

test('the Markdown has the title, the details, each section, and a table with its pipes escaped', () => {
  const md = toMarkdown(doc({ sections: [sec({ body: 'Why.' }), sec({ heading: 'Register', table: { columns: ['Asset', 'Owner'], rows: [['A|B', 'x']] } })] }));
  assert.match(md, /^# ISMS Scope Statement/);
  assert.match(md, /\*\*Version:\*\* 1\.0/);
  assert.match(md, /\*\*Status:\*\* draft/);
  assert.match(md, /## Purpose\n\nWhy\./);
  assert.match(md, /\| Asset \| Owner \|\n\| --- \| --- \|\n\| A\\\|B \| x \|/);
  assert.match(toMarkdown(doc({ title: null })), /^# Document/);
});

test('the download is named by the title, and the published document carries the framework, the clause and the Markdown', () => {
  assert.equal(downloadName({ title: 'ISMS: Scope / Statement' }), 'ISMS_ Scope _ Statement.md');
  assert.equal(downloadName({ title: null }), 'document.md');
  assert.equal(downloadName({ title: '   ' }), 'document.md');
  const d = doc({ title: 'Incident Response Procedure', sections: [sec({ body: 'x' })], owner_id: null, effective_date: null });
  const body = publishBody(d, 'ISO 27001', 12);
  assert.equal(body.description, 'ISO 27001 · ISO/IEC 27001:2022 Cl. 4.3');
  assert.equal(body.doc_type, 'procedure');
  assert.deepEqual(body.framework_ids, [12]);
  assert.deepEqual(body.applicable_framework_ids, [12]);
  assert.equal(body.owner_id, undefined);
  assert.equal(body.effective_date, undefined);
  assert.deepEqual(publishBody(d, 'ISO', null).framework_ids, []);
  assert.equal(publishBody(doc({ classification: null }), 'ISO', 1).classification, 'internal');
});
