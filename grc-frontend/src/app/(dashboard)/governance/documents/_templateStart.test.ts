import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecommendedDoc } from './_recommendedDocsCatalog';
import {
  artifactStart, asPlaceholders, lawFileName, lawStart, ncaStart, ncaTitle, recommendedStart, sessionBody, studioDraftUrl,
} from './_templateStart.ts';

test('a template’s prompts become the studio’s placeholders, links and checkboxes do not', () => {
  assert.equal(asPlaceholders('1. [State the first requirement.]\n2. **[Step name]** — [detail.]'),
    '1. [[State the first requirement.]]\n2. **[[Step name]]** — [[detail.]]');
  assert.equal(asPlaceholders("protects \\<organization name\\>'s assets | \\<Insert job title\\> |"),
    "protects [[organization name]]'s assets | [[Insert job title]] |");
  const kept = 'See [the policy](https://x.test/p), [ref][1], [1]: https://x.test, - [ ] task, [x] done, \\[escaped\\], [[Already]] and [A.5]';
  assert.equal(asPlaceholders(kept), kept.replace('[A.5]', '[[A.5]]'));
});

test('a standard template opens with its text, type, brief and name', () => {
  const doc = { title: 'Cyber Risk Register Procedure', doc_type: 'procedure', category: 'Risk Management', blurb: 'Track risks',
    description: 'How risks are identified and scored.', icon: null as never } as RecommendedDoc;
  const start = recommendedStart(doc);
  assert.equal(start.title, 'Cyber Risk Register Procedure');
  assert.equal(start.doc_type, 'procedure');
  assert.equal(start.template_name, 'Standard template: Cyber Risk Register Procedure');
  const text = start.content ?? '';
  assert.ok(text.startsWith('# Cyber Risk Register Procedure') && text.includes('## Procedure Steps'));
  assert.ok(text.includes('[[Step name]]') && !text.includes(' [Step name]'));
  assert.deepEqual(sessionBody(start), { kind: 'new', title: start.title, doc_type: 'procedure', content: start.content,
    template_name: start.template_name, instructions: { focus_areas: 'How risks are identified and scored.' } });
});

test('an artifact uses the catalogue’s own text when there is one, else the one built here', () => {
  const item = { name: 'Access Review Record', artifact_type: 'Register', description: 'Quarterly review evidence', control_ref: 'A.5.18' };
  const served = artifactStart(item, 'ISO 27001', 'procedure', '# Access Review Record\n\n## Reviewer\n\n[Name of the reviewer]\n');
  assert.equal(served.content, '# Access Review Record\n\n## Reviewer\n\n[[Name of the reviewer]]\n');
  assert.equal(served.template_name, 'ISO 27001 artifact template: Access Review Record');
  const built = artifactStart(item, 'ISO 27001', 'procedure', '  ');
  assert.ok(built.content?.includes('**Control reference:** A.5.18') && built.content.includes('## Purpose\n\nQuarterly review evidence'));
});

test('an NCA template is named as a document and refuses to start from nothing', () => {
  assert.equal(ncaTitle('anti Malware Protection', 'Policy'), 'Anti Malware Protection Policy');
  assert.equal(ncaTitle('Data Cybersecurity  Policy', 'Policy'), 'Data Cybersecurity Policy');
  assert.equal(ncaTitle('Confidentiality Agreement', 'Form'), 'Confidentiality Agreement');
  const start = ncaStart({ title: 'anti Malware Protection', category: 'Policy' }, 'policy', '# Purpose\n\n\\<organization name\\> assets.');
  assert.deepEqual(start, { title: 'Anti Malware Protection Policy', doc_type: 'policy', content: '# Purpose\n\n[[organization name]] assets.',
    template_name: 'NCA template: anti Malware Protection' });
  assert.throws(() => ncaStart({ title: 'Empty', category: 'Policy' }, 'policy', ' \n'), /has no text/);
});

test('a reference law starts the studio’s own template for its type, with the law to attach', () => {
  const start = lawStart({ name: 'Personal Data Protection Law', short_name: 'PDPL', jurisdiction: 'Saudi Arabia', doc_type_hint: 'standard' });
  assert.equal(start.title, 'PDPL Compliance Standard');
  assert.equal(start.doc_type, 'standard');
  assert.equal(start.content, undefined);
  assert.match(start.focus ?? '', /Comply with Personal Data Protection Law \(Saudi Arabia\)/);
  assert.equal(lawStart({ name: 'Some Act', doc_type_hint: 'framework' }).doc_type, 'policy');
  const body = sessionBody(start);
  assert.ok(!('content' in body) && !('template_name' in body));
  assert.equal(lawFileName({ name: 'Law: A/B "C"' }), 'Law A B C.md');
});

test('the old + Draft link opens the studio’s new-document popup filled in', () => {
  assert.equal(studioDraftUrl(new URLSearchParams('')), null);
  const url = studioDraftUrl(new URLSearchParams('aiDraftTitle=Access Control Standard&aiDraftType=standard&aiDraftDescription=Referenced from "ISP".&aiDraftParentId=12&aiDraftFrameworkIds=3, x,4&aiDraftReturn=/governance/documents/12'));
  const q = new URL(`http://h${url}`).searchParams;
  assert.ok(url?.startsWith('/governance/documents/studio?'));
  assert.deepEqual(Object.fromEntries(q), { title: 'Access Control Standard', type: 'standard', description: 'Referenced from "ISP".', parent: '12', frameworks: '3,4' });
  assert.equal(new URL(`http://h${studioDraftUrl(new URLSearchParams('aiDraftTitle=X&aiDraftParentId=1;drop'))}`).searchParams.get('parent'), null);
});
