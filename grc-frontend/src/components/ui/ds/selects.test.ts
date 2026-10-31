// node --test "src/components/ui/ds/selects.test.ts"
// MultiSelect and Combobox (one engine, SelectPopover.tsx). The rules are pure and tested in listboxModel.test.ts; here the markup and the wiring they
// promise are read from source (there is no renderer in this repo). How they behave was checked in a browser on the style guide with real mouse and key
// events: the keys, focus in and out, the search, the footer, a clipping box, and Escape inside a dialog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from './kitRules.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const FILES = ['SelectPopover.tsx', 'MultiSelect.tsx', 'Combobox.tsx', 'listboxModel.ts'];
const engineSource = read('src/components/ui/ds/SelectPopover.tsx');
const engine = strip(engineSource);
const multi = strip(read('src/components/ui/ds/MultiSelect.tsx'));
const combo = strip(read('src/components/ui/ds/Combobox.tsx'));

test('they follow the kit rules: tokens and arbitrary values only', () => {
  for (const file of FILES) assert.deepEqual(findViolations(read(`src/components/ui/ds/${file}`)), [], file);
});

test('MultiSelect and Combobox are thin: both are the engine, one multiple and one single', () => {
  assert.match(multi, /<SelectEngine \{\.\.\.rest\} multiple selected=\{value\} onChoose=\{onChange\} display=\{display\} \/>/);
  assert.match(combo, /<SelectEngine \{\.\.\.rest\} multiple=\{false\} selected=\{value === null \? \[\] : \[value\]\} onChoose=\{\(next\) => onChange\(next\[0\] \?\? null\)\} clearable=\{clearable\} \/>/);
  assert.match(multi, /export interface MultiSelectProps extends SelectBaseProps \{/);
  assert.match(combo, /export interface ComboboxProps extends SelectBaseProps \{/);
  assert.match(multi, /onChange: \(value: string\[\]\) => void;/);
  assert.match(combo, /onChange: \(value: string \| null\) => void;/);
});

test('the button names the control and what is chosen, and says it opens a listbox that it controls only while it is open and has one', () => {
  assert.match(engine, /aria-haspopup="listbox"/);
  assert.match(engine, /aria-expanded=\{open\}/);
  assert.match(engine, /aria-controls=\{open && visible\.length > 0 \? listId : undefined\}/);
  assert.match(engine, /aria-label=\{`\$\{label\}: \$\{summary\.text\}`\}/);               // the name holds the visible words (WCAG 2.5.3)
  assert.match(engine, /title=\{summary\.labels\.length > 1 \? summary\.labels\.join\(', '\) : undefined\}/);
});

test('chips: the comma between two is screen-reader text, so the name ("Draft, Approved +1") is exactly the words the button shows (found by the accessibility probe)', () => {
  assert.match(engine, /\{chip\}\{i < summary\.chips\.length - 1 && <span className="sr-only">,<\/span>\}/);
  assert.match(engine, /\{summary\.more > 0 && <span className="shrink-0 text-ds-label text-ds-fg-muted">\{`\+\$\{summary\.more\}`\}<\/span>\}/);
});

test('FormField wiring: the button takes its id and description from the field around it, and a red outline from its error', () => {
  assert.match(engine, /const a11y = useFieldControl\(\{ id, invalid \}\);/);
  assert.match(engine, /id=\{a11y\.id\}/);
  assert.match(engine, /aria-describedby=\{a11y\['aria-describedby'\]\}/);
  assert.match(engine, /fieldClasses\(a11y\['aria-invalid'\] === true\)/);
  assert.match(engine, /import \{ useFieldControl \} from '\.\/FormField';/);
});

test('the popover is portalled to the body, fixed, above the dialogs, and placed with the Menu\'s rule', () => {
  assert.match(engine, /createPortal\(/);
  assert.match(engine, /document\.body,\n\s*\);/);
  assert.match(engine, /className=\{clsx\('fixed z-\[70\] flex flex-col overflow-hidden/);
  assert.match(engine, /placeMenu\(anchor\.getBoundingClientRect\(\)/);
});

test('the list is a real listbox: named, multiselectable only for several, options that say whether they are chosen and whether they are disabled', () => {
  assert.match(engine, /role="listbox"/);
  assert.match(engine, /aria-label=\{label\}/);
  assert.match(engine, /aria-multiselectable=\{multiple \|\| undefined\}/);
  assert.match(engine, /role="option"/);
  assert.match(engine, /aria-selected=\{chosen\}/);
  assert.match(engine, /aria-disabled=\{option\.disabled \|\| undefined\}/);
  assert.match(engine, /id=\{optionId\(i\)\}/);
});

test('the active option is named by aria-activedescendant on whatever holds focus: the search box, else the list', () => {
  assert.match(engine, /aria-activedescendant=\{activeId\}\n\s*aria-autocomplete="list"/);                       // the search box
  assert.match(engine, /aria-activedescendant=\{searchable \? undefined : activeId\}/);                          // the list, when there is no search box
  assert.match(engine, /tabIndex=\{searchable \? -1 : 0\}/);
});

test('the search box is a combobox of the list: named, expanded, controlling it only while it has options, autocomplete list', () => {
  assert.match(engine, /role="combobox"/);
  assert.match(engine, /aria-label=\{`Search \$\{label\.toLowerCase\(\)\}`\}/);
  assert.match(engine, /aria-expanded="true"/);
  assert.match(engine, /aria-controls=\{visible\.length > 0 \? listId : undefined\}/);
});

test('a list with no match is not an empty listbox: the message stands in its place and the controls point at nothing', () => {
  assert.match(engine, /visible\.length > 0 \? \(\s*<div\s+ref=\{list\}/);
  assert.match(engine, /<p className="px-\[12px\] py-\[16px\] text-center text-ds-body text-ds-fg-muted">\{emptyText\}<\/p>/);
  assert.match(engine, /role="status" aria-live="polite" className="sr-only"/);                                  // "3 matches" is said, not only shown
});

test('the keys are the model\'s decisions, not re-written here', () => {
  for (const fn of ['moveActive(visible, active, key)', 'typeAheadIndex(visible, active, typed.current.text)', 'typeAhead(typed.current, key, Date.now())', 'isTyping(typed.current, Date.now())']) {
    assert.ok(engine.includes(fn), fn);
  }
  for (const fn of ['toggleValue(selected, option.value)', 'selectAll(shown, selected)', 'selectNone(shown, selected)', 'initialActive(options, selected)', 'filterOptions(options, query)']) {
    assert.ok(engine.includes(fn), fn);
  }
});

test('Escape closes the list, gives focus back to the button, and is not heard by a dialog around it', () => {
  assert.match(engine, /if \(key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); onClose\(true\); return; \}/);
  assert.match(engine, /if \(refocus\) trigger\.current\?\.focus\(\);/);
});

test('Tab moves between the search box, the list and the footer buttons, and at an end closes the list and carries on from the button', () => {
  assert.match(engine, /visibleOnly\(el\.querySelectorAll<HTMLElement>\(TABBABLE\)\)/);
  assert.match(engine, /nextFocusIndex\(stops\.length, stops\.indexOf\(document\.activeElement as HTMLElement\), e\.shiftKey\)/);
  assert.match(engine, /if \(to !== null\) onClose\(true\);/);
});

test('Space types into the search box and chooses on the list; Home and End are the list\'s (the box keeps them for the caret); Ctrl+A is for several', () => {
  assert.match(engine, /\(key === ' ' && !inSearch && !spaceInWord\)/);
  assert.match(engine, /\(!inSearch && \(key === 'Home' \|\| key === 'End'\)\)/);
  assert.match(engine, /multiple && !inSearch && key\.toLowerCase\(\) === 'a'/);
});

test('a press or a key in the popover does not reach a clickable row or a dialog around it, and a press on the padding keeps focus', () => {
  assert.match(engine, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(engine, /onMouseDown=\{\(e\) => \{ if \(!\(e\.target as HTMLElement\)\.closest\('input, button'\)\) e\.preventDefault\(\); \}\}/);
  assert.match(engine, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); if \(open\) close\(false\); else show\(e\.detail === 0\); \}\}/);       // the button too
});

test('on a touch screen the search box is not focused when the list opens (the keyboard would cover it)', () => {
  assert.match(engine, /window\.matchMedia\('\(pointer: coarse\)'\)\.matches/);
  assert.match(engine, /\(searchable && !touch \? input\.current : list\.current \?\? box\.current\)\?\.focus\(\{ preventScroll: true \}\)/);
});

test('the popover follows the button when the page scrolls or the window resizes, and closes on a press elsewhere (a soft keyboard must not close it)', () => {
  assert.match(engine, /window\.addEventListener\('scroll', moved, true\);/);
  assert.match(engine, /window\.addEventListener\('resize', moved\);/);
  assert.doesNotMatch(engine, /resize', .*onClose/);
  assert.match(engine, /document\.addEventListener\('mousedown', away\);/);
});

test('the active option stays in view by scrolling the list only, with the tab strip\'s rule', () => {
  assert.match(engine, /scrollDelta\(\{ start: l\.top, end: l\.bottom \}, \{ start: r\.top, end: r\.bottom \}, 0\)/);
  assert.doesNotMatch(engine, /scrollIntoView/);
});

test('a keyboard-opened list shows the ring on its active option at once; the pointer has its hover tint', () => {
  assert.match(engine, /show\(e\.detail === 0\)/);
  assert.match(engine, /if \(!open\) show\(true\);/);
  assert.match(engine, /const \[viaKeys, setViaKeys\] = useState\(byKeys\);/);
  assert.match(engine, /const RING = 'shadow-\[inset_0_0_0_2px_var\(--ds-focus\)\]';/);
});

test('the footer is for several: a count, Select all and Clear on the shown options, disabled when there is nothing for them to do', () => {
  assert.match(engine, /\{multiple && options\.length >= SELECT_ALL_FROM && \(/);
  assert.match(engine, /disabled=\{!canAll\} onClick=\{\(\) => \{ onSelectAll\(visible\); refocus\(\); \}\}/);
  assert.match(engine, /disabled=\{!canClear\} onClick=\{\(\) => \{ onClear\(visible\); refocus\(\); \}\}/);
  assert.match(engine, /export const SELECT_ALL_FROM = 4;/);
});

test('a search box appears from nine options unless the page says so', () => {
  assert.match(engine, /export const SEARCH_FROM = 8;/);
  assert.match(engine, /const withSearch = searchable \?\? options\.length > SEARCH_FROM;/);
});

test('a single choice closes the list and returns focus; choosing the chosen option again clears it only when the field is clearable', () => {
  assert.match(engine, /if \(selected\[0\] === option\.value\) \{ if \(clearable\) onChoose\(\[\]\); close\(true\); return; \}\s*onChoose\(\[option\.value\]\);\s*close\(true\);/);
  assert.match(engine, /if \(multiple\) \{ onChoose\(toggleValue\(selected, option\.value\)\); return; \}/);
});

test('the kit\'s selects do not import the legacy MultiSelectDropdown or any recharts, and the engine is not exported from the kit (use the two components)', () => {
  assert.doesNotMatch(engine + multi + combo, /MultiSelectDropdown|from 'recharts'/);
  assert.doesNotMatch(read('src/components/ui/ds/index.ts') + read('src/components/ui/index.ts'), /SelectPopover|SelectEngine/);
});

test('they are exported from the kit index and the ui barrel, with the option type', () => {
  const ds = read('src/components/ui/ds/index.ts');
  const ui = read('src/components/ui/index.ts');
  assert.match(ds, /export \{ MultiSelect, type MultiSelectProps \} from '\.\/MultiSelect';\nexport \{ Combobox, type ComboboxProps \} from '\.\/Combobox';\nexport type \{ ListOption, SelectDisplay \} from '\.\/listboxModel';/);
  assert.match(ui, /export \{ MultiSelect, type MultiSelectProps \} from '\.\/ds\/MultiSelect';\nexport \{ Combobox, type ComboboxProps \} from '\.\/ds\/Combobox';\nexport type \{ ListOption, SelectDisplay \} from '\.\/ds\/listboxModel';/);
  assert.match(ui, /export \{ MultiSelectDropdown, /, 'the legacy picker is still exported: no page was moved');
});
