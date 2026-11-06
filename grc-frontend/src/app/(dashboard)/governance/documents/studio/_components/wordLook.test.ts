import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockStyle, fontStack, headInk, oneTitle, sheetStyle } from './wordLook.ts';

const props = (css: string) => Object.fromEntries(css.split(';').filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]));

test("a paragraph's look from its Word file replaces the editor's own, whole", () => {
  const css = props(blockStyle({ label: '1.1.', left: 36, hang: 36, font: 'Arial', size: 12, bold: true, underline: true, align: 'center', before: 12, after: 3, line: 1 }));
  assert.equal(css['font-family'], '"Arial", Arimo, sans-serif');
  assert.equal(css['font-size'], '12pt');
  assert.equal(css['font-weight'], '700');
  assert.equal(css['text-decoration'], 'underline');
  assert.equal(css['text-align'], 'center');
  assert.equal(css['margin-top'], '12pt');
  assert.equal(css['margin-bottom'], '3pt');
  assert.equal(css['line-height'], '1');
  assert.equal(css['padding-left'], '36pt');
  assert.equal(css['text-indent'], '-36pt');
  // what the look leaves out is Word's default, so a heading that Word shows as body text is not bold and has no space
  const body = props(blockStyle({ font: 'Arial', size: 10 }));
  assert.deepEqual([body['font-weight'], body['font-style'], body.color, body['margin-top'], body['margin-bottom'], body['line-height']],
    ['400', 'normal', '#000', '0pt', '0pt', 'normal']);
  assert.equal(props(blockStyle({ font: 'Arial', size: 10, line: '14.5pt' }))['line-height'], '14.5pt');
});

test('a look from an older server (numbers and indents only) changes nothing else', () => {
  assert.equal(blockStyle({ label: '▪', left: 108, hang: 18 }), 'padding-left:108pt;text-indent:-18pt;--hang:18pt');
  assert.equal(blockStyle({ body: true }), '');
});

test('a table gets its text size and the fill of its header row, with white text on a dark fill', () => {
  assert.equal(blockStyle({ head_fill: '#C0C0C0', size: 10 }), 'font-size:10pt;--head-fill:#C0C0C0');
  assert.equal(blockStyle({ head_fill: '#000000' }), '--head-fill:#000000;--head-ink:#FFFFFF');
  assert.equal(headInk('#1F497D'), '#FFFFFF');
  assert.equal(headInk('#F2F2F2'), null);
  assert.equal(headInk('#FF0000'), null);                                // Word keeps black text on red
});

test("a number's room reaches the list stop its tab goes to when that comes before the indent", () => {
  assert.equal(props(blockStyle({ label: '1.3.1.', left: 61.2, hang: 61.2, tab: 36 }))['--label'], '36pt');
  assert.equal(props(blockStyle({ label: '1.3.1.1.', left: 90, hang: 54 }))['--label'], undefined);   // text at the indent
});

test("Word's line spacing is a multiple of the font's own single line, as the View draws it; points stay points", () => {
  assert.equal(props(blockStyle({ font: 'Calibri', size: 11, line: 1.15 }, () => 1.22))['line-height'], '1.403');
  assert.equal(props(blockStyle({ font: 'Calibri', size: 11, line: '14pt' }, () => 1.22))['line-height'], '14pt');
  assert.equal(sheetStyle(null, () => 1.22)['--doc-line'], '1.403');      // the platform's own 1.15 lines in Calibri
});

test('nothing a file holds can break out of the style', () => {
  const css = blockStyle({ font: 'Evil"; background:url(x)', size: 10, color: 'red;background:url(x)', line: '1;background:url(x)' as unknown as string });
  assert.doesNotMatch(css.replace(/"[^"]*"/g, '""'), /url\(/);                       // only ever inside the quoted font name
  assert.match(css, /font-family:"Evil; background:url\(x\)", sans-serif/);
  assert.match(css, /color:#000/);
  assert.match(css, /line-height:normal/);
});

test('fonts fall back to fonts of the same widths', () => {
  assert.equal(fontStack('Calibri'), '"Calibri", Carlito, Arial, sans-serif');
  assert.equal(fontStack('Times New Roman'), '"Times New Roman", Tinos, serif');
  assert.equal(fontStack('Verdana'), '"Verdana", sans-serif');
});

test("the page is the Word file's, else the export's A4 with its margins and normal text", () => {
  const word = sheetStyle({ width: 612, left: 72, right: 72, top: 72, normal: { font: 'Arial', size: 10, after: 10, line: 1.15 } });
  assert.equal(word.width, '612pt');
  assert.equal(word.padding, 'min(72pt, 11.765%) min(72pt, 11.765%) min(72pt, 11.765%) min(72pt, 11.765%)');
  assert.deepEqual([word['--doc-font'], word['--doc-size'], word['--doc-after'], word['--doc-line']], ['"Arial", Arimo, sans-serif', '10pt', '10pt', '1.15']);
  for (const none of [null, undefined, {}]) {
    const a4 = sheetStyle(none);
    assert.equal(a4.width, '595.3pt');
    assert.equal(a4.padding, 'min(73.7pt, 12.380%) min(62.35pt, 10.474%) min(73.7pt, 12.380%) min(62.35pt, 10.474%)');
    assert.deepEqual([a4['--doc-font'], a4['--doc-size'], a4['--doc-after'], a4['--doc-line'], a4['--doc-color']],
      ['"Calibri", Carlito, Arial, sans-serif', '10.5pt', '6pt', '1.15', '#000']);
  }
});

test("the export's Title rule: the only level-1 heading, first", () => {
  assert.equal(oneTitle([1, 2, 2, 3]), true);
  assert.equal(oneTitle([1, 2, 1]), false);
  assert.equal(oneTitle([2, 1]), false);
  assert.equal(oneTitle([]), false);
});
