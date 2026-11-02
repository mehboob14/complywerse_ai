// What a searchable select decides, apart from React so `node --test` can pin it (listboxModel.test.ts): which options a search leaves (the same fold as
// the library's search), which option is active after a key, what a toggle, "select all" and "clear" do to the chosen values, where type-ahead lands,
// and what the trigger says about the choice. The components are MultiSelect.tsx and Combobox.tsx, which share SelectPopover.tsx.
import { indexForKey } from '../../../lib/menuModel.ts';

export interface ListOption {
  /** what the page stores (an id, a code) */
  value: string;
  /** what the person reads, and what a search and type-ahead look at */
  label: string;
  /** a second line under the label (an email under a name): searched too */
  description?: string;
  /** shown, cannot be chosen; the arrow keys skip it */
  disabled?: boolean;
}

// ── search ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');

/** Lower-case without accents, so "zurich" finds "Zürich". The same fold as the Documents library's search (libraryModel.fold: a test holds them equal). */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(COMBINING, '').toLowerCase();
}

/** The options a search leaves: every word of `query` (folded) must be in the label or the description. No query, or only spaces, leaves them all. */
export function filterOptions<T extends ListOption>(options: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return options.slice();
  return options.filter((option) => {
    const haystack = fold(`${option.label} ${option.description ?? ''}`);
    return words.every((word) => haystack.includes(word));
  });
}

// ── the active option ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the list opens: the first chosen option that can be chosen, else the first one that can be; -1 when none can. */
export function initialActive(options: readonly ListOption[], selected: readonly string[]): number {
  const chosen = options.findIndex((option) => !option.disabled && selected.includes(option.value));
  return chosen >= 0 ? chosen : options.findIndex((option) => !option.disabled);
}

/** Where a key moves the active option (position `active`, -1 for none yet): ArrowDown and ArrowUp step with a wrap, Home and End go to the first and
 *  the last option that can be chosen, a disabled one is skipped. null for any other key; -1 when nothing can be chosen. The rule of the kit's Menu. */
export function moveActive(options: readonly ListOption[], active: number, key: string): number | null {
  return indexForKey(options, active, key);
}

// ── type-ahead ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The letters typed so far and when the last one was typed. */
export interface TypeBuffer { text: string; at: number }

/** A key press into the buffer: it adds to what was typed within `windowMs`, else it starts again. */
export function typeAhead(previous: TypeBuffer | null, key: string, now: number, windowMs: number = 700): TypeBuffer {
  return previous && now - previous.at <= windowMs ? { text: previous.text + key, at: now } : { text: key, at: now };
}

/** Whether letters are being typed right now: the last one was within `windowMs`. A Space in the middle of a word ("in ap") is part of the word; a Space
 *  on its own chooses the active option. */
export function isTyping(buffer: TypeBuffer | null, now: number, windowMs: number = 700): boolean {
  return buffer !== null && now - buffer.at <= windowMs;
}

/** The option type-ahead lands on, or -1: the next one whose label starts with what was typed (folded), wrapping round. One letter pressed again and
 *  again ("s", "ss") goes through the options that start with it, one after the other; letters that make a word ("sa") keep the active option if it
 *  still starts with them. A disabled option is skipped. */
export function typeAheadIndex(options: readonly ListOption[], active: number, typed: string): number {
  const text = fold(typed);
  const n = options.length;
  if (!text || n === 0) return -1;
  const repeated = text.split('').every((char) => char === text[0]);
  const prefix = repeated ? text[0] : text;
  const from = repeated ? active + 1 : Math.max(active, 0);
  for (let step = 0; step < n; step++) {
    const i = (((from + step) % n) + n) % n;
    if (!options[i].disabled && fold(options[i].label).startsWith(prefix)) return i;
  }
  return -1;
}

// ── what is chosen ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The chosen values with `value` added, or taken out when it is there: in the order they were chosen. A new array. */
export function toggleValue(selected: readonly string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

/** Everything the person can choose among `shown` is chosen: what was chosen stays (in its place), the rest follow in the order of the list; a disabled
 *  option is not added. Pass the options a search left to choose only those. */
export function selectAll(shown: readonly ListOption[], selected: readonly string[]): string[] {
  const added = shown.filter((option) => !option.disabled && !selected.includes(option.value)).map((option) => option.value);
  return [...selected, ...added];
}

/** Nothing among `shown` is chosen: a chosen value that is not shown (a search hides it) stays, and so does a disabled one that cannot be changed. */
export function selectNone(shown: readonly ListOption[], selected: readonly string[]): string[] {
  const clearable = new Set(shown.filter((option) => !option.disabled).map((option) => option.value));
  return selected.filter((value) => !clearable.has(value));
}

// ── the trigger ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SelectDisplay = 'count' | 'chips';

export interface Summary {
  /** nothing is chosen: `text` is the placeholder */
  empty: boolean;
  /** the words: the placeholder, one label, "3 selected", or for chips "Draft, Approved +1" (also what a screen reader and a tooltip say) */
  text: string;
  /** with display "chips": the first two labels drawn as chips (else none) */
  chips: string[];
  /** with display "chips": how many more there are, for "+N" */
  more: number;
  /** every chosen label, for a tooltip */
  labels: string[];
}

/** What the trigger shows for the chosen values. One is its label; several are "3 selected", or with display "chips" the first two as chips and "+N". A
 *  value with no option (the options have not loaded) is shown as it is: a chosen filter is never drawn as "nothing chosen". */
export function summaryOf(options: readonly ListOption[], selected: readonly string[], display: SelectDisplay = 'count', placeholder: string = ''): Summary {
  if (selected.length === 0) return { empty: true, text: placeholder, chips: [], more: 0, labels: [] };
  const labels = selected.map((value) => options.find((option) => option.value === value)?.label ?? value);
  if (display === 'chips') {
    const chips = labels.slice(0, 2);
    const more = labels.length - chips.length;
    return { empty: false, text: chips.join(', ') + (more > 0 ? ` +${more}` : ''), chips, more, labels };
  }
  return { empty: false, text: labels.length === 1 ? labels[0] : `${labels.length} selected`, chips: [], more: 0, labels };
}
