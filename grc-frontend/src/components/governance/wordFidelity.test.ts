import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaderText, mergeStops, nextStop, symbolTwin, tabWidth, wordSize, type TabStop } from './wordFidelity.ts';

const at = (pos: number, kind: TabStop['kind'] = 'left', leader = 'none'): TabStop => ({ pos, kind, leader });

test("a paragraph's tab stops: its style's, then its list level's, then its own, each clearing the stops it names", () => {
  const style = [at(36), at(450, 'right', 'dot')];
  const own = [at(36, 'clear'), at(72)];
  assert.deepEqual(mergeStops([style, [], own]), [at(72), at(450, 'right', 'dot')]);
  assert.deepEqual(mergeStops([[at(216, 'center')], [at(216, 'right')]]), [at(216, 'right')]);   // the nearer layer wins
  // a list level's own list stop takes the place of its style's (Word's tab after "2.3.2.2." goes to 1.25", not 1")
  assert.deepEqual(mergeStops([[at(72, 'num'), at(300, 'right')], [at(90, 'num')]]), [at(90, 'num'), at(300, 'right')]);
});

test('a tab goes to the next stop after it, the hanging indent first when the text has not reached it', () => {
  const toc1 = [at(36), at(450, 'right', 'dot')];
  assert.deepEqual(nextStop(8, toc1, 36, 36), at(36));                     // "1." then the tab to the title
  assert.deepEqual(nextStop(180, toc1, 36, 36), at(450, 'right', 'dot'));  // the title, then the tab to the page number
  assert.deepEqual(nextStop(10, [], 36, 54), at(54));                      // no default stop before the indent: text starts there
  assert.deepEqual(nextStop(10, [at(30)], 36, 54), at(30));                // a custom stop before the indent still counts
  assert.deepEqual(nextStop(60, [], 36, 54), at(72));                      // past the indent: the default stops again
});

test('default stops come every interval from the margin, and only after the last custom stop', () => {
  assert.deepEqual(nextStop(0, [], 36, null), at(36));
  assert.deepEqual(nextStop(36, [], 36, null), at(72));                    // a tab exactly at a stop goes on to the next one
  assert.deepEqual(nextStop(10, [at(100)], 36, null), at(100));            // no default stops before a custom one
  assert.deepEqual(nextStop(120, [at(100)], 36, null), at(144));           // after it, the next multiple of the interval
  assert.deepEqual(nextStop(5, [at(100, 'bar')], 36, null), at(36));       // a bar tab draws a line; it is not a stop
});

test('the width of a tab: to a left stop, a right stop (the text after it ends there), a centre and a decimal stop', () => {
  assert.equal(tabWidth(at(36), 8, 0, 0), 28);
  assert.equal(tabWidth(at(450, 'right'), 200, 6, 6), 244);
  assert.equal(tabWidth(at(300, 'center'), 100, 40, 40), 180);
  assert.equal(tabWidth(at(300, 'decimal'), 100, 40, 25), 175);
  assert.equal(tabWidth(at(450, 'right'), 440, 30, 30), 0);                 // text too long to end at the stop runs on past it
});

test("a symbol font's character is the sign that font draws: the same code is a different sign in Symbol and in Wingdings", () => {
  const pua = (code: number) => String.fromCharCode(0xF000 + code);
  assert.equal(symbolTwin('Symbol', pua(0xE0)), '◊');                       // the AUP's second-level bullet (it showed as an arrow)
  assert.equal(symbolTwin('Wingdings', pua(0xE0)), '→');
  assert.equal(symbolTwin('Symbol', pua(0xB7)), '•');
  assert.equal(symbolTwin('Wingdings', pua(0xA7)), '▪');
  assert.equal(symbolTwin('Wingdings', '§'), '▪');                         // the same code written as 00A7
  assert.equal(symbolTwin('Wingdings', pua(0xD8)), '➢');
  assert.equal(symbolTwin('Symbol', pua(0xA8)), '♦');
  assert.equal(symbolTwin('Symbol', 'a'), 'α');
  assert.equal(symbolTwin('Times New Roman', pua(0xB7)), '•');             // a private-range bullet in another font: as Symbol's
  assert.equal(symbolTwin('Times New Roman', 'o'), null);                  // Courier New's "o" bullet and other text stay as they are
  assert.equal(symbolTwin('Symbol', pua(0xF0)), null);                     // no sign there
  // every Symbol position from 0x20 to 0x7E and from 0xA0 to 0xFE has its sign (the tables are 95 long)
  for (let c = 0x21; c <= 0x7E; c++) assert.ok(symbolTwin('Symbol', pua(c)), `0x${c.toString(16)}`);
  for (let c = 0xA0; c <= 0xFE; c++) if (c !== 0xF0) assert.ok(symbolTwin('Symbol', pua(c)), `0x${c.toString(16)}`);
});

test('a leader fills the tab with its character, leaving a little room', () => {
  assert.equal(leaderText('dot', 30, 2.78), '.'.repeat(9));
  assert.equal(leaderText('hyphen', 10, 3.33), '--');
  assert.equal(leaderText('underscore', 20, 5.56), '__');
  assert.equal(leaderText('none', 100, 2.78), '');
  assert.equal(leaderText('dot', 2, 2.78), '');                             // no room for even one
});

test('a size is drawn as Word draws it, in whole dots at 600 dpi: 10.5 pt is 10.56 pt, 10 pt is 9.96 pt', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  near(wordSize(10.5), 10.56);
  near(wordSize(11), 11.04);
  near(wordSize(10), 9.96);
  near(wordSize(12), 12);
});
