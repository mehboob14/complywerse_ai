// node --test "src/app/(dashboard)/governance/mappings/mappingsPage.test.ts"
// Source-text pins for Governance > Mappings (like reviewsPage.test.ts): what the page must not contain any more (the browser's own dialogs, a clickable div the
// keyboard cannot reach, hover-only actions, text under 12px, the legacy governance-light scope, a bare useMutation) and what it must still do exactly as before
// (the endpoints, the query keys, the payloads, the invalidations, who sees which button, the two modes). There is no React renderer here; what the page does on
// screen is checked in a browser (the G4-G evidence). _scope/scopeLine.test.ts keeps pinning the two permission lines and the "never a raw detail" rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { ownHeadingSection, routeFor } from '../../../../lib/navRegistry.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const read = (name: string): string => readFileSync(`${DIR}${name}`, 'utf8').replace(/\r\n/g, '\n');
/** the source without its comments, so a rule written in a comment is not a use */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const files = (readdirSync(DIR, { recursive: true }) as string[])
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const views = files.filter((f) => f.endsWith('.tsx'));

test('the page and everything it is made of (the files of the folder)', () => {
  assert.deepEqual(files.sort(), [
    '_DocumentList.tsx', '_Embedded.tsx', '_FrameworkGroups.tsx', '_LinkPanel.tsx', '_LinkedControls.tsx', '_MappingDetail.tsx', '_Standalone.tsx', '_queries.ts', '_scope/MappingScope.tsx',
    '_scope/scopeLine.ts', '_types.ts', '_ui.tsx', 'mappingsModel.ts', 'page.tsx',
  ]);
});

test('no window.confirm, alert or prompt is left: the questions are the kit\'s confirm dialog, asked in words that say what will happen', () => {
  for (const f of files) {
    const source = code(read(f));
    assert.ok(!/window\.(confirm|alert|prompt)\b|(^|[^\w.])(confirm|alert|prompt)\(/.test(source.replace(/await confirm\(\{/g, '')), `${f}: a native dialog`);
  }
  const link = read('_LinkPanel.tsx');
  assert.ok(link.includes('useConfirm()') && link.includes("confirmLabel: 'Re-link control'"), 're-linking a control from another document asks through useConfirm');
  assert.ok(/title: 'Re-link this control\?'/.test(link));
  const unlink = read('_LinkedControls.tsx');
  assert.ok(unlink.includes('useConfirm()') && unlink.includes("confirmLabel: 'Unlink control'") && unlink.includes("tone: 'danger'"), 'unlinking asks through useConfirm, as a danger');
});

test('every write is reported (a bare useMutation is gone) and a refusal says so: the four writes of the page', () => {
  for (const f of files) assert.ok(!/\buseMutation\(/.test(code(read(f))), `${f}: a bare useMutation`);
  const count = (f: string) => (code(read(f)).match(/useReportedMutation\(/g) ?? []).length;
  assert.equal(count('_FrameworkGroups.tsx'), 1, 'link / unlink a recommendation');
  assert.equal(count('_LinkPanel.tsx'), 1, 'link an internal control');
  assert.equal(count('_LinkedControls.tsx'), 1, 'unlink an internal control');
  assert.equal(count('_scope/MappingScope.tsx'), 1, 'run the mapping');
  // the drawer and the run say a failure once, in the place it happened (the toast then confirms only)
  assert.ok(/toast: 'success'/.test(read('_LinkPanel.tsx')) && /toast: 'success'/.test(read('_scope/MappingScope.tsx')));
  assert.ok(/failure: "Couldn't link the control"/.test(read('_LinkPanel.tsx')));
  assert.ok(/failure: "Couldn't unlink the control"/.test(read('_LinkedControls.tsx')));
  assert.ok(/failure: "Couldn't start the mapping"/.test(read('_scope/MappingScope.tsx')));
});

test('the requests are the ones the page always made: endpoints, query keys, payloads', () => {
  const q = code(read('_queries.ts'));
  for (const key of ["['governance-documents-list', typeFilter, searchTerm]", "['document-mappings', documentId]", "['internal-controls-for-governance-mapping']",
    "['document-policy-statements', documentId]", "['doc-coverage', documentId]", "['gap-recommended-controls', documentId]"]) assert.ok(q.includes(`queryKey: ${key}`), key);
  assert.ok(q.includes('const params: Record<string, string | number> = { limit: 100 };') && q.includes('params.doc_type = typeFilter') && q.includes('params.search = searchTerm'), 'the list asks for 100 under the type and the search');
  for (const call of ['governanceApi.getDocumentMappings(', 'governanceApi.getDocumentPolicyStatements(', 'governanceApi.getDocumentCoverage(', 'governanceApi.getGapRecommendedControls(', 'ermApi.internalControls.getAll()']) assert.ok(q.includes(call), call);
  assert.ok(q.includes('enabled: !!documentId && enabled') && /useCoverage\(documentId, true\)/.test(code(read('_Embedded.tsx'))) && !/useCoverage\(|useGapRecommended\(/.test(code(read('_Standalone.tsx'))),
    'coverage and the gap recommendations are the document\'s own view only');
  assert.ok(/useInternalControls\(canErm\)/.test(code(read('_Standalone.tsx'))) && /useInternalControls\(canErm\)/.test(code(read('_Embedded.tsx'))), 'the controls are asked for only with the ERM right');

  const link = code(read('_LinkPanel.tsx'));
  assert.ok(link.includes('governanceApi.linkControl({') && /document_id: documentId,\s*internal_control_id: v\.control\.id,\s*link_type: linkType,\s*notes: notes \|\| undefined,\s*force_relink: v\.relink,/.test(link), 'POST /governance/mappings/control with the same payload');
  assert.ok(link.includes("queryKey: ['document-mappings', documentId]"));
  assert.ok(code(read('_LinkedControls.tsx')).includes('governanceApi.unlinkControl(v.link.id)') && code(read('_LinkedControls.tsx')).includes("queryKey: ['document-mappings', v.documentId]"));
  const fw = code(read('_FrameworkGroups.tsx'));
  assert.ok(fw.includes('governanceApi.linkRecommendedControl(documentId as number, {') && /control_kind: r\.control_kind, control_code: r\.control_code, link,/.test(fw));
  assert.ok(fw.includes('governanceApi.linkGapRecommendedControl(documentId as number, {') && fw.includes('control_id: r.control_ref_id') && fw.includes('finding_id: r.finding_id ?? undefined'));
  assert.ok(/if \(r\.source === 'gap'\) \{\s*if \(!link\) return undefined;/.test(fw), 'a gap recommendation can only be linked (the gap API has no unlink)');
  for (const key of ["['document-mappings', documentId]", "['gap-recommended-controls', documentId]", "['doc-coverage', documentId]", "['document-gap-findings', documentId]"]) assert.ok(fw.includes(`queryKey: ${key}`), `refreshed: ${key}`);
  assert.ok(/onSuccess: refresh,\s*onError: refresh,/.test(fw), 'refreshed whatever the answer (the old onSettled)');
  const scope = code(read('_scope/MappingScope.tsx'));
  assert.ok(scope.includes('governanceApi.runDocumentMapping(documentId, extra)') && scope.includes("queryKey: ['document-mapping-run', documentId]") && scope.includes("'/framework-upload/upload'"));
});

test('who sees which button is as it was: the two rights in page.tsx, Link needs the ERM right as well, Unlink the delete right, Run the create right', () => {
  const page = read('page.tsx');
  assert.ok(page.includes("const canCreate = canEdit ?? hasPermission('governance:mappings:create');"));
  assert.ok(page.includes("const canDelete = canEdit ?? hasPermission('governance:mappings:delete');"));
  assert.ok(page.includes("const canErm = hasPermission('erm:risks:view');"));
  assert.ok(/initialDocumentId\?: number; canEdit\?: boolean/.test(page) && /initialDocumentId != null/.test(page), 'the props the document page passes, and what makes it embedded');
  assert.ok(/canCreate && canErm/.test(read('_Standalone.tsx')) && /canCreate && canErm/.test(read('_Embedded.tsx')), 'Link internal control: both rights');
  assert.ok(/if \(canDelete\) columns\.push\(/.test(read('_LinkedControls.tsx')) && /cardActions=\{canDelete \? unlinkButton : undefined\}/.test(read('_LinkedControls.tsx')), 'Unlink: the delete right');
  assert.ok(/canRun=\{canCreate\}/.test(read('_Embedded.tsx')) && /canLink=\{canCreate\}/.test(read('_Embedded.tsx')) && /canLink=\{canCreate\}/.test(read('_Standalone.tsx')));
});

test('the two modes: the standalone page has the kit\'s page head and keeps the open document in the address; the embedded view draws no page head and does not touch the address', () => {
  const standalone = code(read('_Standalone.tsx'));
  assert.ok(/<PageHeader\s+variant="page"/.test(standalone) && standalone.includes('useAddressState(DOC_ADDRESS)'));
  const embedded = code(read('_Embedded.tsx'));
  assert.ok(!/PageHeader|useAddressState|useSearchParams|history\./.test(embedded), 'a document\'s view is a section of the document page: no page head, and its address is the document page\'s');
  assert.equal(routeFor('/governance/mappings')?.ownHeading, true, 'the top bar names only the section where the page draws its own head');
  assert.equal(ownHeadingSection('/governance/mappings'), 'Governance');
  assert.ok(!/\binitialDocumentId\b/.test(standalone) && !/\binitialDocumentId\b/.test(embedded), 'the props are read once, in page.tsx');
});

test('a failed request is never an empty list or a zero: every read says it failed, and the mapped figure has no 0 of its own', () => {
  assert.ok(/ErrorState/.test(read('_Standalone.tsx')) && /ErrorState/.test(read('_Embedded.tsx')) && /ErrorState/.test(read('_DocumentList.tsx')) && /ErrorState/.test(read('_LinkPanel.tsx')));
  assert.ok(/mappedFigure\(/.test(read('_Standalone.tsx')) && /readDocuments\(documents\.data\)/.test(read('_Standalone.tsx')), 'the figure and the total are the model\'s');
  assert.ok(/retry,/.test(read('_queries.ts')) && /canRetry\(error\)/.test(read('_queries.ts')), 'a refusal is said at once, not tried three times');
  assert.ok(/value=\{docsReady \? formatCount\(total\) : null\}/.test(read('_Standalone.tsx')), 'the documents tile is "Not recorded", not 0, until the list answered');
  assert.ok(/cut/.test(read('_Standalone.tsx')) && /Showing the first/.test(read('_Standalone.tsx')), 'a cut list says so, with the true total');
});

test('keyboard: the document list is a listbox with one Tab stop, a framework group says whether it is open, and no clickable div the keyboard cannot reach is left', () => {
  const list = read('_DocumentList.tsx');
  assert.ok(list.includes('role="listbox"') && list.includes('role="option"') && list.includes('aria-selected={selected}') && /tabIndex=\{tabStop \? 0 : -1\}/.test(list));
  assert.ok(list.includes('optionAfter(') && /e\.key === 'Enter' \|\| e\.key === ' '/.test(list), 'arrows, Home/End, Page keys and Enter');
  assert.ok(/aria-expanded=\{shown\}/.test(read('_FrameworkGroups.tsx')) && /aria-controls=\{panel\}/.test(read('_FrameworkGroups.tsx')));
  for (const f of views) {
    const source = code(read(f));
    const clickable = Array.from(source.matchAll(/<(div|span|p|section)\b[^>]*\bonClick=/g)).length;
    assert.equal(clickable, 0, `${f}: a div, span or p with an onClick`);
  }
  assert.ok(/<li\b[^>]*role="option"/.test(list.replace(/\n/g, ' ')), 'the one clickable li is a listbox option, with its key handling on the list');
});

test('the kit and its rules: no legacy picker, search or loader, no .governance-light, no hover-only action, no text under 12px, no named size, palette class or hex in a class', () => {
  for (const f of views) {
    const source = code(read(f));
    assert.ok(!/governance-light/.test(source), `${f}: governance-light`);
    assert.ok(!/MultiSelectDropdown|PageLoader|SearchInput|docUi|BTN_PRIMARY/.test(source), `${f}: a legacy component`);
    assert.ok(!/group-hover|opacity-0/.test(source), `${f}: an action that shows on hover only`);
    assert.deepEqual(findViolations(read(f)), [], `${f}: kit rules`);
  }
});

test('nothing on the page shows a date or a clock, so there is nothing to shift: no toLocale*String, no Date arithmetic', () => {
  for (const f of files) assert.ok(!/toLocale\w*String|new Date\(|Date\.now\(/.test(code(read(f))), f);
});
