// node --test "src/components/ui/ds/controls.test.ts"
// Button, IconButton, FormField, TextInput, Textarea, Select, Checkbox: what can be pinned without a renderer. The class builders are pure and run here;
// the React behaviour (focus, loading, wiring at run time) was checked in a browser. The rest is source text, like kitGuard.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from './kitRules.ts';
import { VARIANT, buttonClasses, iconButtonClasses, type ButtonVariant } from './buttonStyles.ts';
import { READ_ONLY, fieldClasses } from './fieldStyles.ts';

const DIR = 'src/components/ui/ds';
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const src = (file: string) => read(`${DIR}/${file}`);
const tokens = (classes: string) => new Set(classes.split(' '));

const COMPONENTS = ['Button.tsx', 'FormField.tsx', 'TextInput.tsx', 'Textarea.tsx', 'Select.tsx', 'Checkbox.tsx'];
const PURE = ['buttonStyles.ts', 'fieldStyles.ts', 'fieldA11y.ts'];
const NAMES = ['Button', 'IconButton', 'FormField', 'useFieldControl', 'TextInput', 'Textarea', 'Select', 'Checkbox'];

// ── the class recipes (BRIEF_WP5_COMMON.md) ─────────────────────────────────────────────────────────────────────────────────────────────────

test('every variant is the agreed recipe', () => {
  assert.deepEqual(VARIANT, {
    primary: 'bg-ds-primary text-ds-on-primary hover:bg-ds-primary-hover active:bg-ds-primary-active',
    secondary: 'border border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover',
    ghost: 'text-ds-fg-body hover:bg-ds-surface-hover',
    danger: 'bg-ds-danger text-ds-on-danger hover:bg-ds-danger-hover',
    dangerOutline: 'border border-ds-danger-border bg-ds-surface text-ds-danger hover:bg-ds-danger-soft',
    link: 'text-ds-primary-text hover:bg-ds-primary-soft',
  });
});

test('a button is the control box: control height, 6px radius, 13px medium text, 12px padding, a focus ring, a disabled look', () => {
  const t = tokens(buttonClasses());
  for (const c of ['h-ds-control', 'rounded-ds-control', 'text-ds-body', 'px-[12px]', 'gap-[6px]', 'font-medium', 'shrink-0', 'inline-flex',
    'focus-visible:outline-none', 'focus-visible:shadow-ds-ring', 'disabled:cursor-not-allowed', 'disabled:opacity-50', 'aria-disabled:opacity-50']) {
    assert.ok(t.has(c), `missing ${c}`);
  }
  assert.equal(buttonClasses(), buttonClasses({ variant: 'secondary', size: 'md' }), 'secondary and md are the defaults');
});

test('the small button is 28px (h-ds-control-sm) with the label size; the large one never mentions it', () => {
  const sm = tokens(buttonClasses({ size: 'sm' }));
  assert.ok(sm.has('h-ds-control-sm') && sm.has('text-ds-label') && !sm.has('h-ds-control') && !sm.has('text-ds-body'));
  const md = tokens(buttonClasses({ size: 'md' }));
  assert.ok(md.has('h-ds-control') && !md.has('h-ds-control-sm'));
});

test('a loading button keeps its colours and only changes the cursor; full width adds w-full', () => {
  const busy = tokens(buttonClasses({ variant: 'primary', loading: true }));
  assert.ok(busy.has('bg-ds-primary') && busy.has('cursor-progress') && !busy.has('disabled:opacity-50') && !busy.has('aria-disabled:opacity-50'));
  assert.ok(tokens(buttonClasses({ fullWidth: true })).has('w-full'));
  assert.ok(!tokens(buttonClasses()).has('w-full'));
});

test('an icon button is a control-height square that follows the control-height token (32px, 44px on touch), never a fixed size', () => {
  for (const v of ['ghost', 'secondary'] as const) {
    const t = tokens(iconButtonClasses(v));
    assert.ok(t.has('h-ds-control') && t.has('w-[var(--ds-control-h)]') && t.has('p-0') && t.has('focus-visible:shadow-ds-ring'));
    assert.ok(!Array.from(t).some((c) => /^px-/.test(c)), 'no horizontal padding: the box is square');
  }
  assert.equal(iconButtonClasses(), iconButtonClasses('ghost'));
  assert.ok(tokens(iconButtonClasses('secondary')).has('border-ds-border-strong'));
});

test('the field box: one outline colour at a time, read-only is not in the shared string (a <select> is always :read-only)', () => {
  const ok = tokens(fieldClasses(false));
  const bad = tokens(fieldClasses(true));
  assert.ok(ok.has('border-ds-border-control') && !ok.has('border-ds-danger'));
  assert.ok(bad.has('border-ds-danger') && !bad.has('border-ds-border-control'));
  for (const t of [ok, bad]) {
    for (const c of ['bg-ds-surface', 'text-ds-fg', 'text-ds-body', 'rounded-ds-control', 'placeholder:text-ds-fg-muted', 'focus-visible:shadow-ds-ring', 'disabled:bg-ds-surface-subtle', 'disabled:opacity-50']) {
      assert.ok(t.has(c), `missing ${c}`);
    }
    assert.ok(!Array.from(t).some((c) => c.startsWith('read-only:')));
  }
  assert.equal(READ_ONLY, 'read-only:bg-ds-surface-subtle');
  assert.ok(src('TextInput.tsx').includes('READ_ONLY') && src('Textarea.tsx').includes('READ_ONLY'));
  assert.ok(!src('Select.tsx').includes('READ_ONLY'));
});

test('every class string the builders produce passes the kit guard', () => {
  const all: string[] = [];
  const variants = Object.keys(VARIANT) as ButtonVariant[];
  for (const variant of variants) for (const size of ['md', 'sm'] as const) for (const loading of [false, true]) for (const fullWidth of [false, true]) all.push(buttonClasses({ variant, size, loading, fullWidth }));
  all.push(iconButtonClasses('ghost'), iconButtonClasses('secondary'), fieldClasses(false), fieldClasses(true), READ_ONLY);
  for (const classes of all) assert.deepEqual(findViolations(`<x className="${classes}" />`), [], classes);
});

// ── Button and IconButton ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Button: type is "button" unless given, so a button in a form never submits by accident; IconButton the same', () => {
  const s = src('Button.tsx');
  assert.equal((s.match(/type = 'button'/g) ?? []).length, 2, 'Button and IconButton both default the type');
  assert.ok(/forwardRef<HTMLButtonElement \| HTMLAnchorElement, ButtonProps>/.test(s));
  assert.ok(/forwardRef<HTMLButtonElement, IconButtonProps>/.test(s));
});

test('IconButton: label is required (in the props type) and becomes aria-label and the title', () => {
  const s = src('Button.tsx');
  const block = /export interface IconButtonProps[^{]*\{([\s\S]*?)\n\}/.exec(s)?.[1] ?? '';
  assert.ok(/\n\s*label: string;/.test(`\n${block}`), 'label: string, not optional');
  assert.ok(!/label\?:/.test(block));
  assert.ok(/Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>/.test(s), 'a caller cannot override the name');
  assert.ok(s.includes('title={label}') && s.includes('aria-label={label}'));
  assert.ok(s.indexOf('title={label}') < s.indexOf('{...rest}'), 'an explicit title wins over the label');
});

test('Button loading: aria-busy, presses are swallowed, and the button stays focusable (aria-disabled, not the disabled attribute)', () => {
  const s = src('Button.tsx');
  assert.ok(s.includes('aria-busy={busy}') && s.includes('aria-disabled={busy}'));
  assert.ok(s.includes('onClick={loading ? swallow : onClick}'));
  assert.ok(/disabled=\{disabled\}/.test(s) && !/disabled=\{disabled \|\| loading\}/.test(s), 'loading must not set the disabled attribute: focus would be lost');
  assert.ok(s.includes('Loader2') && s.includes('animate-spin'));
  assert.ok(s.includes('opacity-0') && !/\binvisible\b/.test(s), 'the label of a loading button stays in the accessibility tree');
});

test('Button href: a next/link with the same classes; a disabled or loading link has no href, aria-disabled, tabIndex -1 and role link', () => {
  const s = src('Button.tsx');
  assert.ok(s.includes("import Link from 'next/link'") && s.includes('<Link {...anchor}'));
  const inert = /<a \{\.\.\.anchor\}[\s\S]*?>\{content\}<\/a>/.exec(s)?.[0] ?? '';
  assert.ok(inert, 'the disabled branch renders a plain <a>');
  assert.ok(!/href=/.test(inert), 'no href: it cannot be followed by click, middle click or "open in a new tab"');
  for (const part of ['role="link"', 'aria-disabled="true"', 'tabIndex={-1}']) assert.ok(inert.includes(part), part);
  assert.ok(s.includes('if (disabled || loading)'));
});

// ── FormField and the controls inside it ────────────────────────────────────────────────────────────────────────────────────────────────────

test('FormField: generated ids, a label that points at the control, the required mark, the optional mark, the error as an alert', () => {
  const s = src('FormField.tsx');
  assert.ok(s.includes('useId()') && s.includes('htmlFor={id}'));
  assert.ok(s.includes('aria-hidden="true"') && s.includes('> (required)</span>') && s.includes('className="sr-only"'), 'a * for the eye, "required" for the screen reader');
  assert.ok(s.includes('(optional)'));
  assert.ok(/<p id=\{errorId\} role="alert"/.test(s) && /<p id=\{hintId\}/.test(s));
  assert.ok(/value=\{state\}/.test(s) && /describedBy: describedBy\(hasHint && hintId, hasError && errorId\), invalid: hasError, required/.test(s));
  assert.ok(/export function useFieldControl/.test(s));
  assert.ok(!/\bh-\[|min-h-/.test(s), 'no heights in the field wrapper');
});

test('TextInput, Textarea, Select and Checkbox take their wiring from the field and forward their ref', () => {
  for (const f of ['TextInput.tsx', 'Textarea.tsx', 'Select.tsx', 'Checkbox.tsx']) {
    const s = src(f);
    assert.ok(s.includes("import { useFieldControl } from './FormField'"), `${f} reads the field`);
    assert.ok(/forwardRef</.test(s), `${f} forwards its ref`);
    assert.ok(/\{\.\.\.a11y\}/.test(s) && /\{\.\.\.rest\}/.test(s), `${f} puts the wiring on the element`);
    assert.ok(s.indexOf('{...rest}') < s.indexOf('{...a11y}'), `${f}: the field's wiring comes after the caller's props`);
  }
});

test('Textarea: a maxLength counter as a polite live region, controlled or not', () => {
  const s = src('Textarea.tsx');
  assert.ok(s.includes('aria-live="polite"') && s.includes('{used} / {maxLength}'));
  assert.ok(s.includes('maxLength !== undefined'), 'no counter without a limit');
  assert.ok(/rest\.value !== undefined \? String\(rest\.value\)\.length : typed/.test(s));
});

test('Select is the native <select> with a chevron and an optional empty first option, not a custom list', () => {
  const s = src('Select.tsx');
  assert.ok(s.includes('<select') && s.includes('ChevronDown') && s.includes('appearance-none'));
  assert.ok(!/role="(listbox|combobox|option)"/.test(s));
  assert.ok(s.includes('<option value="" data-placeholder="">'));
  assert.ok(s.includes('has-[option[data-placeholder]:checked]:text-ds-fg-muted') && s.includes('[&>option]:text-ds-fg'), 'grey while the placeholder shows, the open list keeps strong text');
  assert.ok(s.includes('pointer-events-none'), 'the chevron does not take clicks');
});

test('Checkbox: a native box, an inline label with the touch padding on the label, indeterminate set as a property after every render', () => {
  const s = src('Checkbox.tsx');
  assert.ok(s.includes('type="checkbox"') && s.includes('accent-ds-primary'));
  assert.ok(/inner\.current\.indeterminate = indeterminate/.test(s));
  assert.ok(/useEffect\(\(\) => \{[\s\S]*?\n  \}\);/.test(s), 'no dependency list: a click clears the property in the DOM');
  assert.ok(s.includes('var(--ds-control-h)') && /<label\b[\s\S]*?py-\[calc/.test(s), 'the label carries the padding that makes the row a control high');
  assert.ok(s.includes('h-[16px] w-[16px]'), 'the box itself stays 16px');
});

// ── the kit's rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('every file passes the kit guard and none uses tailwind-merge or a fixed control height', () => {
  for (const f of [...COMPONENTS, ...PURE]) {
    const s = src(f);
    assert.deepEqual(findViolations(s), [], f);
    assert.ok(!/from ['"]tailwind-merge['"]|twMerge\(/.test(s), `${f} must not merge ds classes`);
    assert.ok(!/(?<![\w-])(?:min-|max-)?h-\[(?:28|32|44)px\]/.test(s), `${f} hard-codes a control height`);
  }
});

test('components are client files; the pure helpers import nothing, so node can run them', () => {
  for (const f of COMPONENTS) assert.ok(src(f).startsWith("'use client';"), `${f} needs 'use client'`);
  for (const f of PURE) assert.ok(!/^import /m.test(src(f)), `${f} must stay dependency-free`);
});

test('every interactive piece has the focus ring', () => {
  for (const f of ['buttonStyles.ts', 'fieldStyles.ts', 'Checkbox.tsx']) {
    assert.ok(src(f).includes('focus-visible:outline-none focus-visible:shadow-ds-ring'), f);
  }
});

test('the names are exported from the kit index and from the ui barrel', () => {
  const kit = src('index.ts');
  const barrel = read('src/components/ui/index.ts');
  for (const n of NAMES) {
    assert.ok(new RegExp(`export \\{[^}]*\\b${n}\\b[^}]*\\} from './`).test(kit), `ds/index.ts exports ${n}`);
    assert.ok(new RegExp(`export \\{[^}]*\\b${n}\\b[^}]*\\} from './ds/`).test(barrel), `ui/index.ts re-exports ${n}`);
  }
});
