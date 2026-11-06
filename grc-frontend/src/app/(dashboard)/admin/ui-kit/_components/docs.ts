// What the style guide says about each shared component, written by hand from its source: where to import it, when to use it, the one trap worth
// a warning, and its props. Plain data, so docs.test.ts can keep it honest: every prop a component declares must be documented here, every
// documented name must still exist in the source, every import line must resolve, and every component the kit exports must have an entry.
// Add a prop, a component or a state to the kit and the test fails until this file (and the demo next to it) says so.

export interface PropDoc {
  name: string;
  type: string;
  default?: string;
  note: string;
  /** an attribute of the HTML element the kit passes through and does something with (documented, not declared by the component) */
  native?: boolean;
  /** a row that stands for the props another interface adds ("...ConfirmRequest"): not a prop of its own */
  inherited?: boolean;
}

export interface PartDoc {
  /** the exported name: Button, TableFrame, nextSort */
  name: string;
  /** file of the component, from grc-frontend/; with `own`, docs.test.ts compares the props with the interface */
  source?: string;
  /** the interface that declares the props written in the file */
  own?: string;
  /** a function or a hook: its table says Call / Returns instead of Prop / Type / Default */
  fn?: boolean;
  props: PropDoc[];
}

export interface ComponentDoc {
  name: string;
  /** the import line: from '@/components/ui' where the barrel has it, else the file */
  importFrom: string;
  /** the names that line imports (default: the first part) */
  imports?: string[];
  use: string;
  dont?: string;
  parts: PartDoc[];
}

const prop = (name: string, type: string, note: string, def?: string): PropDoc => ({ name, type, note, default: def });
const native = (p: PropDoc): PropDoc => ({ ...p, native: true });
const inherited = (p: PropDoc): PropDoc => ({ ...p, inherited: true });
const CLASS_NAME = prop('className', 'string', 'Layout only (width, margin). Colour and size come from the component.');
const UI = '@/components/ui';
const DS = 'src/components/ui/ds';
const UIDIR = 'src/components/ui';

const SELECT_BASE: PartDoc = {
  name: 'SelectBaseProps', source: `${DS}/SelectPopover.tsx`, own: 'SelectBaseProps',
  props: [
    prop('label', 'string', 'The control\'s name ("Status"): it names the button ("Status: Draft, Approved") and the list for a screen reader, and is drawn before the choice with `showLabel`.'),
    prop('options', 'readonly ListOption[]', 'What can be chosen.'),
    prop('placeholder', 'string', 'What the button says while nothing is chosen ("All statuses").', "'Select…'"),
    prop('searchable', 'boolean', 'A search box above the options (every word must be in the label or the description, any case, no accents: the library\'s fold). The default is yes from 9 options.', 'options > 8'),
    prop('searchPlaceholder', 'string', 'What the empty search box says.', "'Search'"),
    prop('emptyText', 'string', 'What the list says when a search leaves no option.', "'No matches'"),
    prop('showLabel', 'boolean', 'Draws the name before the choice ("Status: Draft"): for a filter bar that has no FormField label.', 'false'),
    prop('disabled', 'boolean', 'Shown, cannot be opened.', 'false'),
    prop('invalid', 'boolean', 'A red outline (a FormField with an error does this by itself).', 'false'),
    prop('id', 'string', 'The button\'s id, when the page needs a fixed one; a FormField gives it one and points its label at it.'),
    CLASS_NAME,
  ],
};

const LIST_OPTION: PartDoc = {
  name: 'ListOption', source: `${DS}/listboxModel.ts`, own: 'ListOption',
  props: [
    prop('value', 'string', 'What the page stores (an id, a code).'),
    prop('label', 'string', 'What the person reads; search and type-ahead look at it.'),
    prop('description', 'string', 'A second line under the label (an email under a name); searched too.'),
    prop('disabled', 'boolean', 'Shown, cannot be chosen; the arrow keys skip it.'),
  ],
};

export const DOCS: Record<string, ComponentDoc> = {
  Button: {
    name: 'Button',
    importFrom: UI,
    use: 'the person takes an action: primary for the one that fills the page, danger for the destructive step, link for a quiet jump.',
    dont: 'Do not set `disabled` to explain a refusal (a disabled button says nothing: put the reason in a hint), and do not rely on it submitting a form: `type` is "button" unless you write "submit".',
    parts: [
      {
        name: 'Button', source: `${DS}/Button.tsx`, own: 'ButtonOwn',
        props: [
          prop('variant', "'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline' | 'link'", 'Which button it is.', "'secondary'"),
          prop('size', "'md' | 'sm'", 'md is the control height (32 px, 44 px on touch); sm is 28 px (44 px on touch).', "'md'"),
          prop('loading', 'boolean', 'A spinner replaces the left icon (or sits over the middle). The button keeps its width, ignores presses and reports aria-busy; it stays focusable.', 'false'),
          prop('leftIcon', 'ReactNode', 'Any lucide icon; drawn at 16 px.'),
          prop('rightIcon', 'ReactNode', 'Same, after the label.'),
          prop('fullWidth', 'boolean', 'Fills the line (a phone form).', 'false'),
          prop('disabled', 'boolean', 'A button is :disabled; a link or a loading button carries aria-disabled.', 'false'),
          prop('href', 'string', 'With href it is a link (next/link) with the same look and the anchor\'s attributes. A disabled link is drawn without an href.'),
          native(prop('type', "'button' | 'submit' | 'reset'", 'A button inside a form never submits by accident.', "'button'")),
          CLASS_NAME,
        ],
      },
    ],
  },
  IconButton: {
    name: 'IconButton',
    importFrom: UI,
    use: 'an action is one icon: close, delete a row, a table toolbar.',
    dont: 'Do not leave `label` out: an icon names nothing, so the label is required and becomes the aria-label and the tooltip.',
    parts: [
      {
        name: 'IconButton', source: `${DS}/Button.tsx`, own: 'IconButtonProps',
        props: [
          prop('label', 'string', 'What the button does ("Delete row"). Required: accessible name and tooltip.'),
          prop('variant', "'ghost' | 'secondary'", 'Quiet or outlined.', "'ghost'"),
          native(prop('children', 'ReactNode', 'The icon (any lucide icon, drawn at 16 px). A square, as high as a control.')),
        ],
      },
    ],
  },
  FormField: {
    name: 'FormField',
    importFrom: UI,
    imports: ['FormField', 'useFieldControl'],
    use: 'you place any control: it wires the label, the required or optional mark, the hint and the error to the control inside it.',
    dont: 'Do not pass `id` or aria attributes to the control inside: the field owns them (pass `id` to FormField when the page needs a fixed one). Text that prevents a mistake is a `hint`; an explanation for the curious is `info`.',
    parts: [
      {
        name: 'FormField', source: `${DS}/FormField.tsx`, own: 'FormFieldProps',
        props: [
          prop('label', 'ReactNode', 'The label; it points at the control.'),
          prop('required', 'boolean', 'Adds the red * (read out as "required") and aria-required on the control.', 'false'),
          prop('optional', 'boolean', 'Adds "(optional)" after the label; ignored when required.', 'false'),
          prop('info', 'string', 'An explanation shown from the (i) beside the label; when the label is text the (i) is named "About <label>".'),
          prop('hint', 'ReactNode', 'Muted help under the control; the control is described by it.'),
          prop('error', 'ReactNode', 'Red, under the control, read out as it appears (role="alert"); the control becomes invalid.'),
          prop('id', 'string', 'The control\'s id, when the page needs a fixed one.', 'generated'),
          CLASS_NAME,
          prop('children', 'ReactNode', 'One control: TextInput, Textarea, Select, Checkbox, or your own through useFieldControl().'),
        ],
      },
      {
        name: 'useFieldControl', source: `${DS}/FormField.tsx`, fn: true,
        props: [prop('useFieldControl(own?)', 'id + ARIA attributes', 'Spread what it returns on your element: the field\'s id, aria-describedby, aria-invalid and aria-required, merged with the control\'s own `id`, `invalid`, `required` and aria props. Works without a FormField.')],
      },
    ],
  },
  TextInput: {
    name: 'TextInput',
    importFrom: UI,
    use: 'one line of text is asked for, inside a FormField (or named with aria-label when it stands alone).',
    parts: [
      {
        name: 'TextInput', source: `${DS}/TextInput.tsx`, own: 'TextInputProps',
        props: [
          prop('invalid', 'boolean', 'Red outline and aria-invalid; a FormField with an error does this by itself.', 'false'),
          prop('leftAdornment', 'ReactNode', 'An icon inside the box, decoration only (it does not take clicks).'),
          prop('rightAdornment', 'ReactNode', 'Inside the box on the right; may hold a button.'),
          prop('unit', 'string', 'A word after the value, inside the box ("days"). The box keeps room for it, so typed text never runs under it; with type="number" the digits are right-aligned in tabular figures and the spin arrows are hidden (the arrow keys still step). The unit is read out with the field, before its hint.'),
          native(prop('readOnly', 'boolean', 'Greys the box and keeps the words at full contrast.')),
          CLASS_NAME,
        ],
      },
    ],
  },
  Textarea: {
    name: 'Textarea',
    importFrom: UI,
    use: 'several lines of text are asked for; with `maxLength` it counts what is used.',
    parts: [
      {
        name: 'Textarea', source: `${DS}/Textarea.tsx`, own: 'TextareaProps',
        props: [
          prop('invalid', 'boolean', 'Red outline and aria-invalid.', 'false'),
          native(prop('rows', 'number', 'Visible lines.', '3')),
          native(prop('maxLength', 'number', 'The browser enforces it, and the box shows "123 / 500" in a polite live region.')),
          CLASS_NAME,
        ],
      },
    ],
  },
  Select: {
    name: 'Select',
    importFrom: UI,
    use: 'the choice is among a few options: the browser\'s own list, so it works on a phone and with a screen reader.',
    dont: 'Do not use it for a long searchable list (use the combo box), and do not fake a placeholder with a disabled option: use `placeholder`.',
    parts: [
      {
        name: 'Select', source: `${DS}/Select.tsx`, own: 'SelectProps',
        props: [
          prop('invalid', 'boolean', 'Red outline and aria-invalid.', 'false'),
          prop('placeholder', 'string', 'Adds a first, empty option with this text; it reads grey while it is showing.'),
          prop('children', 'ReactNode', 'The <option>s.'),
          CLASS_NAME,
        ],
      },
    ],
  },
  MultiSelect: {
    name: 'MultiSelect',
    importFrom: UI,
    imports: ['MultiSelect'],
    use: 'the person chooses several values from a list: statuses, owners, frameworks. A button that says what is chosen ("3 selected", or the first two as chips and "+N") opens a popover of options with checkboxes, a search box when the list is long, and Select all / Clear. The popover is drawn on the window, so a table, a card or a dialog cannot clip it. Keys: ArrowDown, ArrowUp, Home, End, a letter (type-ahead), Space or Enter to choose, Ctrl+A to choose all shown, Escape to close.',
    dont: 'Do not use it for one value (Combobox) or for a few fixed choices (checkboxes in the form), and do not leave `label` out: it names the button and the list for a screen reader. A chosen value whose option has not loaded yet is shown as it is, never as "nothing chosen": do not hide a filter that is in force.',
    parts: [
      {
        name: 'MultiSelect', source: `${DS}/MultiSelect.tsx`, own: 'MultiSelectProps',
        props: [
          prop('value', 'readonly string[]', 'The values chosen, in the order they were chosen.'),
          prop('onChange', '(value: string[]) => void', 'The whole choice after a change: a new array.'),
          prop('display', "'count' | 'chips'", 'How the button shows several: "3 selected" (one is its label), or the first two as chips and "+N".', "'count'"),
          inherited(prop('...SelectBaseProps', '', 'label, options, placeholder, searchable, searchPlaceholder, emptyText, showLabel, disabled, invalid, id, className: see below.')),
        ],
      },
      SELECT_BASE,
      LIST_OPTION,
    ],
  },
  Combobox: {
    name: 'Combobox',
    importFrom: UI,
    use: 'the person chooses ONE value from a list that may be long (an owner, a department, a framework): the browser\'s own select cannot search. The same button, popover and keys as MultiSelect; choosing an option closes the list and gives focus back to the button, so the next Tab goes on.',
    dont: 'Do not use it for a handful of options (Select: the browser\'s own list works on a phone and with a screen reader), and do not leave `label` out. It is the kit\'s: the older ComboBoxInput and MultiSelectDropdown keep their own looks until their pages move.',
    parts: [
      {
        name: 'Combobox', source: `${DS}/Combobox.tsx`, own: 'ComboboxProps',
        props: [
          prop('value', 'string | null', 'The value chosen, or null for none.'),
          prop('onChange', '(value: string | null) => void', 'The value chosen, or null when it was cleared.'),
          prop('clearable', 'boolean', 'Choosing the chosen option again clears it: for a field that may stay empty.', 'false'),
          inherited(prop('...SelectBaseProps', '', 'label, options, placeholder, searchable, searchPlaceholder, emptyText, showLabel, disabled, invalid, id, className: see below.')),
        ],
      },
      SELECT_BASE,
      LIST_OPTION,
    ],
  },
  Checkbox: {
    name: 'Checkbox',
    importFrom: UI,
    use: 'it is a yes or no, or one of several picks. The label is the click and touch target.',
    dont: 'Do not leave a bare box (no `label`) unnamed: pass aria-label.',
    parts: [
      {
        name: 'Checkbox', source: `${DS}/Checkbox.tsx`, own: 'CheckboxProps',
        props: [
          prop('label', 'ReactNode', 'Beside the box; its padding brings the row up to the control height.'),
          prop('indeterminate', 'boolean', 'The "some selected" state of a select-all box.', 'false'),
          prop('invalid', 'boolean', 'aria-invalid.', 'false'),
          CLASS_NAME,
        ],
      },
    ],
  },
  StatusPill: {
    name: 'StatusPill',
    importFrom: UI,
    use: 'you show the state of a record: a dot and a word on a soft tint. Take the tone and word from a registry in lib/status.ts.',
    dont: 'Do not pick the colour by hand or draw the dot alone: spread `statusPill(registry, word)` so one word looks the same everywhere, and the word is always there for people who cannot tell the tones apart.',
    parts: [
      {
        name: 'StatusPill', source: `${DS}/StatusPill.tsx`, own: 'StatusPillProps',
        props: [
          prop('tone', "'success' | 'danger' | 'warning' | 'progress' | 'pending' | 'neutral'", 'The colour family.'),
          prop('label', 'string', 'What the person reads. A blank one is drawn as the dash, so a pill is never a dot alone.'),
          prop('size', "'sm' | 'md'", 'sm for a dense table cell.', "'md'"),
          CLASS_NAME,
        ],
      },
    ],
  },
  Avatar: {
    name: 'Avatar',
    importFrom: UI,
    use: 'a person appears as initials in a colour that is theirs on every page. Alone it is an image carrying the name.',
    dont: 'Do not let a screen reader hear the name twice: when the name is written beside it, pass `decorative` (PersonChip does).',
    parts: [
      {
        name: 'Avatar', source: `${DS}/Avatar.tsx`, own: 'AvatarProps',
        props: [
          prop('name', 'string | null', 'A missing name draws a quiet grey "?" that a screen reader skips.'),
          prop('size', '20 | 24 | 32', 'The 20 px circle shows one letter (two would need type under 12 px).', '24'),
          prop('decorative', 'boolean', 'Hide it from a screen reader.', 'false'),
          CLASS_NAME,
        ],
      },
    ],
  },
  PersonChip: {
    name: 'PersonChip',
    importFrom: UI,
    use: 'an owner, assignee or author appears in a cell or a line: avatar and name.',
    dont: 'Do not leave an empty cell for a missing owner: it reads "Unassigned" (a missing owner is information).',
    parts: [
      {
        name: 'PersonChip', source: `${DS}/PersonChip.tsx`, own: 'PersonChipProps',
        props: [
          prop('name', 'string | null', 'A name that does not fit is cut with an ellipsis and keeps its full text in a title.'),
          prop('size', '20 | 24 | 32', 'Avatar size.', '24'),
          prop('emptyLabel', 'string', 'Shown when there is no name.', "'Unassigned'"),
          CLASS_NAME,
        ],
      },
    ],
  },
  PersonStack: {
    name: 'PersonStack',
    importFrom: UI,
    use: 'a few people show at a glance (reviewers, approvers): the first N as avatars, then a "+M" button that lists the rest.',
    dont: 'Do not overlap the avatars: the initials tell two people apart and a tucked-under neighbour hides half of one.',
    parts: [
      {
        name: 'PersonStack', source: `${DS}/PersonStack.tsx`, own: 'PersonStackProps',
        props: [
          prop('people', 'Array<string | null | undefined>', 'Display names; a blank one is left out.'),
          prop('max', 'number', 'How many avatars show before the +M button.', '3'),
          prop('size', '20 | 24 | 32', 'Avatar size.', '24'),
          prop('label', 'string', 'What the group is, for a screen reader ("Reviewers").'),
          prop('emptyLabel', 'string', 'Shown when there is nobody.', "'Unassigned'"),
          CLASS_NAME,
        ],
      },
    ],
  },
  EmptyState: {
    name: 'EmptyState',
    importFrom: UI,
    use: 'a list answered and has nothing to show. firstUse says how to start; noMatches says the filters leave none.',
    dont: 'Do not let the two read alike: "Clear filters" belongs to noMatches only. Do not use it while loading (Skeleton) or after a failure (ErrorState).',
    parts: [
      {
        name: 'EmptyState', source: `${DS}/EmptyState.tsx`, own: 'EmptyStateProps',
        props: [
          prop('kind', "'firstUse' | 'noMatches'", 'Nothing yet, or the filters leave none.'),
          prop('title', 'string', 'What is empty.'),
          prop('description', 'string', 'One sentence under the title.'),
          prop('info', 'string', 'What the state used to explain in a sentence, shown from an (i) beside the title: for a page that prints labels, not sentences.'),
          prop('icon', 'LucideIcon', 'A magnifier for noMatches, an inbox for firstUse.'),
          prop('action', 'ReactNode', 'The one primary action: what fills the page.'),
          prop('onClearFilters', '() => void', 'noMatches only: shows a "Clear filters" button.'),
          prop('tips', 'string[]', 'Up to three short hints; more are left out.'),
          prop('bare', 'boolean', 'No frame, for a card that already has one.', 'false'),
          CLASS_NAME,
        ],
      },
    ],
  },
  ErrorState: {
    name: 'ErrorState',
    importFrom: UI,
    use: 'a view could not load or save: say what failed and, when the server said why, that too. Retry only when trying again can help.',
    dont: 'Do not show an empty table or a zero for a failed request, and do not print a raw exception: pass the server\'s words through safeDetail first.',
    parts: [
      {
        name: 'ErrorState', source: `${DS}/ErrorState.tsx`, own: 'ErrorStateProps',
        props: [
          prop('title', 'string', 'What failed.', "\"Couldn't load this\""),
          prop('message', 'string', 'Why, cleaned of anything a person should not see.'),
          prop('onRetry', '() => void', 'Shows the Retry button.'),
          prop('compact', 'boolean', 'A row without a frame, for the inside of a card.', 'false'),
          CLASS_NAME,
        ],
      },
    ],
  },
  Skeleton: {
    name: 'Skeleton',
    importFrom: UI,
    imports: ['Skeleton', 'SkeletonLines', 'SkeletonRows'],
    use: 'a view is loading: grey blocks that pulse (stilled for reduced motion). A group says "Loading" once and is marked busy.',
    dont: 'Do not show a count, a zero or an empty table while loading.',
    parts: [
      { name: 'Skeleton', source: `${DS}/Skeleton.tsx`, own: 'SkeletonProps', props: [prop('className', 'string', 'The size, in arbitrary values: h-[16px] w-[120px].')] },
      {
        name: 'SkeletonLines', source: `${DS}/Skeleton.tsx`, own: 'SkeletonLinesProps',
        props: [
          prop('lines', 'number', 'The last one is shorter.', '3'),
          prop('label', 'string', 'What a screen reader says.', "'Loading'"),
          prop('className', 'string', 'Layout only.'),
        ],
      },
      {
        name: 'SkeletonRows', source: `${DS}/Skeleton.tsx`, own: 'SkeletonRowsProps',
        props: [
          prop('rows', 'number', 'Table rows.', '5'),
          prop('columns', 'number', 'Cells in a row.', '4'),
          prop('label', 'string', 'What a screen reader says.', "'Loading'"),
          prop('className', 'string', 'Layout only.'),
        ],
      },
    ],
  },
  NoAccessState: {
    name: 'NoAccessState',
    importFrom: UI,
    use: 'the signed-in person may not open a page or a part of it. A status, not an alert: nothing failed, the person was turned away.',
    dont: 'Do not use it for a failed request (ErrorState), and do not rely on hiding the link: the page must render this itself, because nothing else blocks a typed address.',
    parts: [
      {
        name: 'NoAccessState', source: `${DS}/NoAccessState.tsx`, own: 'NoAccessStateProps',
        props: [
          prop('title', 'string', 'What happened.', "\"You don't have access to this page\""),
          prop('reason', 'string', 'Why, when the page knows ("This page is for administrators.").'),
          prop('action', 'ReactNode', 'Where to go instead, usually <Button href=…>.'),
          CLASS_NAME,
        ],
      },
    ],
  },
  Notice: {
    name: 'Notice',
    importFrom: UI,
    use: 'a page has something to say about the list or the card under it: the list is cut ("Showing 100 of 174"), a source is missing, a setting is off. The tone is also an icon, so it never rests on colour alone.',
    dont: 'Do not use it for a failed request (ErrorState has Retry and says what failed), for the confirmation of something the person just did (a toast) or for what blocks the page (NoAccessState), and do not stack two: say the one that matters.',
    parts: [
      {
        name: 'Notice', source: `${DS}/Notice.tsx`, own: 'NoticeProps',
        props: [
          prop('tone', "'info' | 'warning' | 'danger'", 'What kind of notice it is: its icon, its tint and its role.', "'info'"),
          prop('title', 'string', 'The bold first line: what is the case ("Showing 100 of 174 exceptions").'),
          prop('children', 'ReactNode', 'The line under the title, or the only line when there is no title. It may hold a link.'),
          prop('action', 'ReactNode', 'What the person can do about it: a Button or a link, after the words. It drops under them on a narrow screen.'),
          prop('icon', 'LucideIcon', 'Replaces the tone\'s icon (an info circle, a warning triangle, a danger circle).'),
          prop('role', "'status' | 'alert'", 'status is polite, alert is assertive. The default follows the tone: an info notice is a status, a warning or a danger is an alert. Pass status for a notice that is on the page from the moment it loads.', 'by tone'),
          CLASS_NAME,
        ],
      },
    ],
  },
  PageHeader: {
    name: 'PageHeader',
    importFrom: UI,
    use: 'any page starts. variant="page" is the head of the new standard: back link, title, (i), one line of facts, status chips and actions.',
    dont: 'Do not write a sentence in `meta` (one line of facts) or give two pages the classic and the new head: variant="page" ignores subtitle, icon, filters and the breadcrumbs, and "classic" is the legacy look kept for pages that have not moved.',
    parts: [
      {
        name: 'PageHeader', source: `${UIDIR}/PageHeader.tsx`, own: 'PageHeaderProps',
        props: [
          prop('title', 'string', 'The page\'s h1.'),
          prop('variant', "'classic' | 'page'", 'classic is the header every page had; page is the new standard.', "'classic'"),
          prop('meta', 'ReactNode', 'page: one line of facts ("44 documents · updated 5 d ago").'),
          prop('info', 'string', 'page: what the page used to explain in a sentence, shown from an (i) beside the title.'),
          prop('back', '{ href; label }', 'page: a link to the list the record belongs to ("Back to vendors").'),
          prop('chips', 'ReactNode', 'page: status pills under the title.'),
          prop('actions', 'ReactNode', 'Buttons on the right; on a phone they drop under the title.'),
          prop('subtitle', 'string', 'classic only.'),
          prop('icon', 'LucideIcon', 'classic only.'),
          prop('iconColor', "'primary' | 'success' | 'warning' | 'danger' | 'info'", 'classic only.', "'primary'"),
          prop('filters', 'ReactNode', 'classic only: a row under the title.'),
          prop('breadcrumbs', 'BreadcrumbItem[]', 'classic only.'),
          prop('showBreadcrumb', 'boolean', 'classic only.', 'true'),
          prop('className', 'string', 'Layout only (margin).'),
        ],
      },
    ],
  },
  Tabs: {
    name: 'Tabs',
    importFrom: UI,
    imports: ['Tabs', 'TabPanel', 'useTabParam'],
    use: 'one record or page splits into sections. The open tab lives in the address (?tab=) through useTabParam, so a link, a reload and Back land where the person was.',
    dont: 'Do not hold the open tab in React state alone, and do not confuse useTabParam with the older @/lib/useTabParam. Pass only the keys on offer today, so an address that asks for a hidden tab opens the fallback.',
    parts: [
      {
        name: 'Tabs', source: `${DS}/Tabs.tsx`, own: 'TabsProps',
        props: [
          prop('tabs', 'TabItem[]', 'The strip.'),
          prop('value', 'K extends string', 'The key of the open tab. Its type is the type of `onChange`\'s key: the union of the keys useTabParam was given, or plain string.', 'string'),
          prop('onChange', '(key: K) => void', 'Called with the key of the tab that was picked (click, arrow keys, Home, End). Typed by `value`: a useTabParam setter is passed as it is, with no cast.'),
          prop('ariaLabel', 'string', 'Names the tab list for a screen reader.'),
          prop('countFormat', "'capped' | 'exact'", 'How a count reads. capped: 100 and over read "99+" (what every caller had). exact: the true count with its separator ("1,247"), for a register whose tab counts are the server\'s totals.', "'capped'"),
          prop('children', 'ReactNode', 'The TabPanels.'),
          CLASS_NAME,
        ],
      },
      {
        name: 'TabItem', source: `${DS}/Tabs.tsx`, own: 'TabItem',
        props: [
          prop('key', 'string', 'Its name in the address.'),
          prop('label', 'string', 'What the tab says.'),
          prop('count', 'number', 'A badge beside the name; 100 and over read "99+" (or "1,247" with `countFormat="exact"`); 0 is a count.'),
          prop('disabled', 'boolean', 'Shown, cannot be opened, skipped by the arrow keys.'),
          prop('hidden', 'boolean', 'Not shown at all.'),
        ],
      },
      {
        name: 'TabPanel', source: `${DS}/Tabs.tsx`, own: 'TabPanelProps',
        props: [
          prop('tabKey', 'string', 'The tab this panel belongs to.'),
          prop('lazy', 'boolean', 'Draw the content only after the first visit, then keep it (hidden) so typed or scrolled state survives.', 'false'),
          prop('children', 'ReactNode', 'The content.'),
          prop('className', 'string', 'Layout only: no display classes (open or shut is the hidden attribute).'),
        ],
      },
      {
        name: 'useTabParam', source: `${DS}/useTabParam.ts`, fn: true,
        props: [prop('useTabParam(paramName, keys, { fallback, aliases? })', '[tab, setTab]', 'The open tab, kept in the address. The default tab has the plain address; picking a tab replaces the address (Back is not filled with tab clicks) and never scrolls; an alias keeps an old ?tab= name from an email or a bookmark working. Pass only the keys on offer today.')],
      },
    ],
  },
  useAddressState: {
    name: 'useAddressState',
    importFrom: UI,
    use: 'a page keeps several things in its address (the search, the filters, the sort, the page) so a link, a reload and Back land where the person was. You give it a schema (a name, what its values mean and its default); it gives you the state and a setter that shows a change at once and rewrites the address: it replaces, it does not push, unless asked.',
    dont: 'Do not define the schema inside the component (it would read the address again on every render), do not keep the same state in React state as well, and do not put anything private in an address: it is stored in history, shared by link and sent in emails. For the open tab alone use useTabParam.',
    parts: [
      {
        name: 'useAddressState', fn: true,
        props: [
          prop('useAddressState(schema)', '[state, set]', 'The state the address stands for (every name, its default where the address has nothing usable) and a setter. A name the schema does not list is left alone, and so is the hash. When the address changes (a link, Back) it is the truth again, unless it already says what the page holds ("policy " in a search box and the trimmed "policy" the address keeps are one state).'),
          prop('set(patch, options?)', 'void', 'Merges `patch` into the state, shows it at once and rewrites the address with history.replaceState (no navigation, no history entry, no scroll). Two changes in one event compose.'),
        ],
      },
      {
        name: 'AddressStateOptions', source: `${DS}/useAddressState.ts`, own: 'AddressStateOptions',
        props: [prop('push', 'boolean', 'Add a history entry (pushState) instead of replacing the current one: for a step Back should undo, such as opening a record.', 'false')],
      },
    ],
  },
  'Address params': {
    name: 'Address params',
    importFrom: '@/lib/addressState',
    imports: ['oneOf', 'text', 'listOf', 'flag', 'integer', 'sortOf', 'readAddress', 'writeAddress', 'sameAddressState'],
    use: 'you write the schema for useAddressState, or you need the rules apart from React (tested): what an address means, what a state writes back. A value that is not usable is the default, so an address can never put a page in a state it cannot be in. A ParamSpec of your own is just a default, a read and a write.',
    dont: 'Do not trust an address: every kind reads junk as the default. Do not put a comma in a list value (a list is written comma-separated), and do not keep two names for one thing: other params of the address are left alone, so a name the schema lists is the page\'s.',
    parts: [
      { name: 'oneOf', fn: true, props: [prop('oneOf(options, fallback)', 'ParamSpec<T>', 'One of the options, any case, spaces ignored. The first occurrence of a repeated name decides. Written as the option, and nothing when it is the fallback.')] },
      { name: 'text', fn: true, props: [prop('text()', 'ParamSpec<string>', 'Free text (a search box): read as it is, written trimmed, nothing when blank. The default is the empty string.')] },
      { name: 'listOf', fn: true, props: [prop('listOf(options?)', 'ParamSpec<string[]>', 'Every occurrence of the name and every comma-separated piece, trimmed, without blanks or repeats, in the order first seen. With `options` anything else is dropped. Written as one comma-separated value.')] },
      { name: 'flag', fn: true, props: [prop('flag()', 'ParamSpec<boolean>', '`1` or `true` is on; anything else is off. Written as `1`, nothing when off.')] },
      { name: 'integer', fn: true, props: [prop('integer(fallback, { min?, max? })', 'ParamSpec<number>', 'A whole number (a page): digits only, within min and max, else the fallback. Written when it is not the fallback.')] },
      { name: 'sortOf', fn: true, props: [prop('sortOf(keys, fallback)', 'ParamSpec<SortState>', '`key:dir` with a key from `keys` and asc or desc. `none` is "no sort" (how a page that sorts by default says it was cleared). Written when it is not the fallback. Has the shape of the table kit\'s SortState.')] },
      { name: 'readAddress', fn: true, props: [prop('readAddress(schema, search)', 'AddressState', 'The state an address stands for. Names the schema does not list are ignored; `search` may start with "?".')] },
      { name: 'writeAddress', fn: true, props: [prop('writeAddress(schema, search, state)', 'string', 'The query string (no "?") for a state: the defaults are left out, every other param of `search` is kept in its place, the schema\'s own come after in the schema\'s order, so one state is one address.')] },
      { name: 'sameAddressState', fn: true, props: [prop('sameAddressState(schema, a, b)', 'boolean', 'Whether two states write the same address.')] },
    ],
  },
  Pager: {
    name: 'Pager',
    importFrom: UI,
    use: 'a list is paged: "1–25 of 1,243 documents", the page, Previous and Next, and optionally the page size.',
    dont: 'Do not pass the length of the array that came back as `total`: pass the server\'s true total, so a list capped at 100 of 1,243 reads "1–100 of 1,243".',
    parts: [
      {
        name: 'Pager', source: `${DS}/Pager.tsx`, own: 'PagerProps',
        props: [
          prop('page', 'number', '1-based; a page outside the range is clamped.'),
          prop('pageSize', 'number', 'Items per page.'),
          prop('total', 'number', 'The true number of items on the server.'),
          prop('onPage', '(page) => void', 'Previous or Next was pressed.'),
          prop('onPageSize', '(size) => void', 'Gives a "Rows per page" choice; the caller decides what else changes (usually back to page 1).'),
          prop('pageSizes', 'readonly number[]', 'The choices; the size in use is always among them.', '[10, 25, 50, 100]'),
          prop('noun', 'string | { one; other }', 'What is counted: the plural ("documents"), or { one: "committee", other: "committees" } so a list of exactly one reads "1–1 of 1 committee". "0 committees" and every other count use `other`.', "'items'"),
          CLASS_NAME,
        ],
      },
    ],
  },
  Menu: {
    name: 'Menu',
    importFrom: UI,
    use: 'a short list of actions sits behind one button: "⋯" on a table row, or a page\'s "Actions".',
    dont: 'Do not clip it inside a table or a dialog with your own dropdown: this one is drawn on the window. Destructive items set themselves off below a line, so do not put them first.',
    parts: [
      {
        name: 'Menu', source: `${DS}/Menu.tsx`, own: 'MenuProps',
        props: [
          prop('label', 'string', 'The button\'s name for a screen reader and its text unless iconOnly ("Actions for Acme Ltd" on a row).'),
          prop('items', 'MenuItem[]', 'A menu with nothing to show renders nothing.'),
          prop('iconOnly', 'boolean', 'A "⋯" button with no text, for row actions.', 'false'),
          prop('align', "'start' | 'end'", 'Which edge of the button the list lines up with.', "'end'"),
          prop('size', "'md' | 'sm'", 'md is the control height (32 px, 44 px on touch); sm is 28 px (44 px on touch), for the end of a row of chips.', "'md'"),
          prop('disabled', 'boolean', 'The button cannot be pressed.', 'false'),
          prop('className', 'string', 'Layout only (margin).'),
        ],
      },
      {
        name: 'MenuItem', source: `${DS}/Menu.tsx`, own: 'MenuItem',
        props: [
          prop('key', 'string', 'Identity.'),
          prop('label', 'string', 'What the item says.'),
          prop('icon', 'LucideIcon', 'Before the label.'),
          prop('onSelect', '() => void', 'Runs after the menu closes and focus is back on the button.'),
          prop('danger', 'boolean', 'The destructive step: red, set off by a line above it.'),
          prop('section', 'string', 'A title for the group this item starts: the items after it, up to the next titled item, are that group (`role="group"` named by the title). A titled group is set off by a line above it.'),
          prop('checked', 'boolean', 'A check at the end of the item (true: on, false: off). The item becomes a `menuitemcheckbox`, with `aria-checked`.'),
          prop('radio', 'boolean', 'With `checked`: one choice of a group (a sort order), a `menuitemradio`.'),
          prop('trailing', 'string', 'A value or a count at the end ("A to Z", "1,247").'),
          prop('reason', 'string', 'Under a disabled item, why it cannot be chosen ("Needs the edit right"). The item stays reachable by the arrow keys (`aria-disabled`, the words are its description) so a keyboard or screen-reader user meets the reason; without a reason a disabled item is skipped as always.'),
          prop('disabled', 'boolean', 'Shown, cannot be chosen; the arrow keys skip it.'),
          prop('hidden', 'boolean', 'Not shown at all.'),
        ],
      },
    ],
  },
  'Table primitives': {
    name: 'Table primitives',
    importFrom: UI,
    imports: ['TableFrame', 'Table', 'THead', 'TBody', 'Tr', 'Th', 'Td', 'RowHeaderCell'],
    use: 'you need a table the register does not fit: a scrolling frame, a real <table> that names itself, header cells that sort and say so (aria-sort), rows that open from the keyboard.',
    dont: 'Do not restyle cells with palette classes: the shell\'s table CSS needs the kit\'s important modifiers, so use these parts instead of bare <table> elements.',
    parts: [
      {
        name: 'TableFrame', source: `${DS}/Table.tsx`, own: 'TableFrameProps',
        props: [
          prop('aria-label', 'string', 'What the scrolling region is called. The frame is a tab stop (a region that scrolls must be reachable by keyboard).'),
          prop('maxHeight', 'string', 'A max-h-[70vh] class written out in full; with it the frame scrolls inside and a sticky header stays in view.'),
          CLASS_NAME,
          prop('children', 'ReactNode', 'The Table.'),
        ],
      },
      { name: 'Table', source: `${DS}/Table.tsx`, own: 'TableProps', props: [prop('caption', 'string', 'The table\'s name: read out, not drawn.'), prop('children', 'ReactNode', 'THead and TBody.')] },
      { name: 'THead', props: [prop('className', 'string', 'Native <thead> attributes.')] },
      { name: 'TBody', props: [prop('className', 'string', 'Native <tbody> attributes.')] },
      {
        name: 'Tr', source: `${DS}/Table.tsx`, own: 'TrProps',
        props: [
          prop('onActivate', '() => void', 'The row opens something: it becomes a tab stop; a click on it (not on a control inside) or Enter / Space calls this.'),
          prop('selected', 'boolean', 'The row that is open or chosen: tinted and aria-selected.', 'false'),
        ],
      },
      {
        name: 'Th', source: `${DS}/Table.tsx`, own: 'ThProps',
        props: [
          prop('align', "'left' | 'right' | 'center'", 'Text alignment.', "'left'"),
          prop('priority', '1 | 2 | 3', '1 is always shown; 2 from 768 px; 3 from 1024 px.', '1'),
          prop('sticky', 'boolean', 'Stays at the top of the frame while rows scroll (the frame needs a maxHeight).', 'false'),
          prop('sortKey', 'string', 'The column can be sorted; this is its key in `sort`.'),
          prop('sort', 'SortState', 'The table\'s current sort; the header says it with aria-sort.', 'null'),
          prop('onSortChange', '(next) => void', 'With sortKey the header is a button; a click asks for nextSort().'),
          prop('sortCycle', "'asc-desc-none' | 'asc-desc'", 'Whether a third click clears the sort.', "'asc-desc-none'"),
          prop('firstDir', "'asc' | 'desc'", 'The direction a first click sorts in ("Updated" newest first).', "'asc'"),
        ],
      },
      { name: 'Td', source: `${DS}/Table.tsx`, own: 'TdProps', props: [prop('align', "'left' | 'right' | 'center'", 'Text alignment.', "'left'"), prop('priority', '1 | 2 | 3', 'Same as Th.', '1')] },
      { name: 'RowHeaderCell', source: `${DS}/Table.tsx`, own: 'RowHeaderCellProps', props: [prop('align', "'left' | 'right' | 'center'", 'The cell that names its row: a <th scope="row"> that looks like any other cell.', "'left'"), prop('priority', '1 | 2 | 3', 'Same as Th.', '1')] },
    ],
  },
  RegisterTable: {
    name: 'RegisterTable',
    importFrom: UI,
    use: 'a list of one kind of record needs sortable columns, a row that opens, and a state for every moment (loading, failed, empty). A table from 768 px, cards below.',
    dont: 'Do not put ids in a column `cell`, and do not put an input there that must exist once: a cell is drawn twice, in the table and on the card (a `cardCell` gives the card its own version). Never pass [] for a request that has not answered or has failed: use `loading` and `error`.',
    parts: [
      {
        name: 'RegisterTable', source: `${DS}/RegisterTable.tsx`, own: 'RegisterTableProps',
        props: [
          prop('caption', 'string', 'Names the table, its scrolling region and the card list.'),
          prop('columns', 'RegisterColumn<T>[]', 'See below.'),
          prop('rows', 'T[]', 'Already in the order `sort` asks for (sortRows for a list held on the client).'),
          prop('getRowId', '(row) => string | number', 'A stable id per row.'),
          prop('sort', 'SortState', 'The page owns the order.', 'null'),
          prop('onSortChange', '(next) => void', 'Without it no header sorts.'),
          prop('onRowActivate', '(row) => void', 'Rows (and cards) become tab stops; click, Enter and Space call this.'),
          prop('selectedId', 'string | number | null', 'The row that is open or chosen.', 'null'),
          prop('loading', 'boolean', 'The header and skeleton rows; no count, no footer.', 'false'),
          prop('loadingRows', 'number', 'How many skeleton rows.', '6'),
          prop('error', '{ message; onRetry? } | null', 'The request failed: a message (and Retry) in place of rows.', 'null'),
          prop('empty', 'ReactNode', 'The page\'s own empty state, drawn in place of the table.'),
          prop('footer', 'ReactNode', 'Under the frame in every state but loading: the pager and count.'),
          prop('cardTitle', '(row) => ReactNode', 'The first thing on a card.'),
          prop('cardActions', '(row) => ReactNode', 'The row\'s actions on a card, at the top right beside the title: a Menu ("⋯"). A press anywhere in the slot is not a press on the card. The table has no such slot (its actions are a column), so the card gets its own and the column gets card: \'hide\'.'),
          prop('stickyHead', 'boolean', 'The header stays in view while the rows scroll in the frame.', 'false'),
          prop('hideHeader', 'boolean', 'The header row is not drawn but is still read out (sr-only, never display:none): for a table whose columns the caption and the cells already make plain. A column `width` then applies to the cells; cards are unaffected.', 'false'),
          prop('maxHeight', 'string', 'A max-h-[70vh] class written out in full.'),
        ],
      },
      {
        name: 'RegisterColumn', source: `${DS}/RegisterTable.tsx`, own: 'RegisterColumn',
        props: [
          prop('key', 'string', 'What `sort` holds.'),
          prop('header', 'string', 'The header text, and the label of the card line.'),
          prop('cell', '(row) => ReactNode', 'Drawn in the table AND on the card (both are in the page, CSS shows one): no ids in it, and no control that must exist once. For an inline control give the column a `cardCell`.'),
          prop('priority', '1 | 2 | 3', '1 always; 2 from 768 px; 3 from 1024 px. Cards ignore it.', '1'),
          prop('align', "'left' | 'right' | 'center'", 'Text alignment.'),
          prop('sortable', 'boolean', 'A click on the header sorts (needs onSortChange).'),
          prop('firstDir', "'asc' | 'desc'", 'The direction a first click sorts in.'),
          prop('width', 'string', 'A w-[160px] class written out in full: the preferred width.'),
          prop('isRowHeader', 'boolean', 'The cell names its row (<th scope="row">).'),
          prop('card', "'meta' | 'hide'", 'meta makes it a "label: value" line under the card title; otherwise it is not on the card.'),
          prop('cardLabel', 'string', 'The card line\'s label when the header is not the right word.'),
          prop('cardCell', '(row) => ReactNode', 'What the card\'s line holds instead of `cell`, when the cell is an inline control (an input, a select) that must not be drawn twice: show its value as words. Only for a column with card: \'meta\'.'),
        ],
      },
    ],
  },
  'Table logic': {
    name: 'Table logic',
    importFrom: UI,
    imports: ['nextSort', 'ariaSort', 'sortRows', 'priorityClass', 'rowCountText'],
    use: 'you need the rules behind the register apart from React (tested): which way a click sorts, what aria-sort says, how a client-held list is ordered, which columns give way, how many rows to say there are.',
    parts: [
      { name: 'nextSort', fn: true, props: [prop('(current, key, cycle?, firstDir?)', 'SortState', 'The sort a header click asks for: first click firstDir, then reversed, then (asc-desc-none) cleared.')] },
      { name: 'ariaSort', fn: true, props: [prop('(columnKey, sort, sortable)', "'ascending' | 'descending' | 'none' | undefined", 'The aria-sort of a header; undefined (attribute left off) for a column that cannot sort.')] },
      { name: 'sortRows', fn: true, props: [prop('(rows, sort, valueOf)', 'T[]', 'A new array in order: numbers by value, text in natural order, empty values last, ties keep their order.')] },
      { name: 'priorityClass', fn: true, props: [prop('(priority?)', 'string', 'The classes that hide a priority-2 or -3 cell on a narrower window.')] },
      { name: 'rowCountText', fn: true, props: [prop('({ shown, total, noun, plural?, loading?, failed? })', 'string | null', '"25 of 312 documents"; null while loading, after a failure or with no known total: a count is never made up.')] },
    ],
  },
  Formatting: {
    name: 'Formatting',
    importFrom: '@/lib/format',
    imports: ['formatDate', 'formatDateTime', 'formatRelative', 'orEmpty', 'formatCount', 'formatPercent', 'formatCompact', 'statusLabel', 'truncate', 'moreCount', 'EMPTY', 'NOT_SET', 'UNASSIGNED'],
    use: 'a date, a count, an empty value or a status word is shown on a page: one module writes them all, so every viewer reads the same text (the server stamps times in naive UTC; parseUtc is applied inside).',
    dont: 'Do not call toLocaleDateString or toFixed on a page, do not write "N/A", "None", "Unknown" or "-" for a missing value, and do not shift a date that has no time: a day is the same day in every time zone.',
    parts: [
      {
        name: 'formatDate', fn: true,
        props: [
          prop('(value, { empty?, calendar? })', 'string', '"12 Nov 2026". A date with no time never moves; a moment shows the viewer\'s own day. calendar: true is for a field that means a day but arrives as a DateTime ("2026-03-25T00:00:00"). `empty` is what a missing date says (default "—").'),
        ],
      },
      { name: 'formatDateTime', fn: true, props: [prop('(value, { empty?, calendar? })', 'string', '"12 Nov 2026, 14:05": 24-hour clock in the viewer\'s zone. A date with no time, or calendar: true, shows just the date.')] },
      { name: 'formatRelative', fn: true, props: [prop('(value, today?, { calendar? })', 'string', '"today", "in 9 days", "3 days ago", counted in calendar days; "" when there is no date.')] },
      { name: 'orEmpty', fn: true, props: [prop('(value, empty?)', 'string', 'The value as text, or the empty word when it is missing, blank or not a number. 0 is a value.')] },
      { name: 'formatCount', fn: true, props: [prop('(n, empty?)', 'string', '"1,234": whole numbers with thousands separators; "—" when there is no number.')] },
      { name: 'formatPercent', fn: true, props: [prop('(n, empty?)', 'string', '"7.5%", "12%": n is already a percent; one decimal only below 10; no trailing ".0".')] },
      { name: 'formatCompact', fn: true, props: [prop('(n, empty?)', 'string', '"999", "1.2k", "3.4M": a number in a tile; rounding up rolls into the next unit.')] },
      { name: 'statusLabel', fn: true, props: [prop('(value, empty?)', 'string', '"in_remediation" becomes "In remediation".')] },
      { name: 'truncate', fn: true, props: [prop('(text, max)', '{ text, truncated, full }', 'A preview of at most `max` characters, cut at a word when that keeps half the room, never half an emoji. `full` is for a tooltip.')] },
      { name: 'moreCount', fn: true, props: [prop('(items, shown = 2)', '{ shown, rest, more }', 'The first two and "+N": `more` is the N.')] },
      { name: 'EMPTY', fn: true, props: [prop('"—"', 'string', 'Nothing is recorded: a value the person cannot set, or that the system has not produced yet.')] },
      { name: 'NOT_SET', fn: true, props: [prop('"Not set"', 'string', 'A value the person can configure and has not.')] },
      { name: 'UNASSIGNED', fn: true, props: [prop('"Unassigned"', 'string', 'An owner or assignee nobody has been chosen for.')] },
    ],
  },
  SectionCard: {
    name: 'SectionCard',
    importFrom: UI,
    use: 'a settings or detail page splits into cards: a title with its (i), one line of facts, the card\'s own actions on the right, then the content. It is a region named by its heading and an anchor (#id) a link can point at.',
    dont: 'Do not put prose in `meta` (facts, not sentences: "6 departments · 1 inactive"), and do not reuse an `id` on the page: it is the anchor and what names the region.',
    parts: [
      {
        name: 'SectionCard', source: `${DS}/SectionCard.tsx`, own: 'SectionCardProps',
        props: [
          prop('id', 'string', 'The card\'s anchor and what names its heading: `#due`. Kept clear of a sticky header by scroll-margin.'),
          prop('title', 'string', 'The card\'s h2.'),
          prop('info', 'string', 'What the card used to explain in a sentence, shown from an (i) beside the title.'),
          prop('meta', 'ReactNode', 'One line of facts after the title.'),
          prop('actions', 'ReactNode', 'The card\'s actions, on the right of the title row (they wrap under it on a phone).'),
          prop('children', 'ReactNode', 'The content.'),
        ],
      },
    ],
  },
  SaveBar: {
    name: 'SaveBar',
    importFrom: UI,
    use: 'a form saves as a whole: the strip sticks to the bottom of the page and says one thing at a time ("Unsaved changes", "Fix the fields in red to save", what the server refused with, "Saved"), with Discard and Save only while there is something to save.',
    dont: 'Do not draw a save row of your own, show the bar to a person who cannot edit (canEdit false draws nothing), or word the states yourself: the words are the platform\'s, and only a refusal carries other words (the server\'s). A refusal outranks "fix the fields", which outranks "unsaved".',
    parts: [
      {
        name: 'SaveBar', source: `${DS}/SaveBar.tsx`, own: 'SaveBarProps',
        props: [
          prop('label', 'string', 'Names the bar\'s region for a screen reader ("Save the settings").'),
          prop('onSave', '() => void', 'Save was pressed.'),
          prop('onDiscard', '() => void', 'Discard was pressed.'),
          prop('saveLabel', 'string', 'The Save button\'s words.', "'Save'"),
          prop('discardLabel', 'string', 'The Discard button\'s words.', "'Discard'"),
          inherited(prop('…SaveBarInput', 'canEdit, dirty, invalid, saving, justSaved, error', 'What decides the state: see SaveBarInput below.')),
        ],
      },
      {
        name: 'SaveBarInput', source: `${DS}/saveBarModel.ts`, own: 'SaveBarInput',
        props: [
          prop('canEdit', 'boolean', 'The person may change the form at all: false (view-only) and the bar is never shown.'),
          prop('dirty', 'boolean', 'The form differs from what is saved: the bar shows, with Discard and Save.'),
          prop('invalid', 'boolean', 'A field is wrong: it says "Fix the fields in red to save" and Save is not offered until it is fixed.'),
          prop('saving', 'boolean', 'The request is on its way: Save shows its spinner (and keeps focus), Discard is off.'),
          prop('justSaved', 'boolean', 'The last save went through a moment ago: "Saved", with no buttons, and focus moves to the line. The page clears it again after a few seconds.'),
          prop('error', 'string | null', 'What the server said when the last save was refused; blank or missing: nothing.'),
        ],
      },
    ],
  },
  SegmentedControl: {
    name: 'SegmentedControl',
    importFrom: UI,
    use: 'a short list of choices has one chosen ("In-app | Email | Both | Off"): a native radio group, so Tab enters and leaves it once, the arrow keys move the choice and a screen reader says "2 of 4".',
    dont: 'Do not use it for a long list or for a choice that opens something (Select, Menu). Give each group its own `name` on the page and a `label` that says what it chooses: the group is named by it.',
    parts: [
      {
        name: 'SegmentedControl', source: `${DS}/SegmentedControl.tsx`, own: 'SegmentedControlProps',
        props: [
          prop('label', 'string', 'What the group is called for a screen reader (read out, not drawn).'),
          prop('name', 'string', 'The radio group\'s name: unique on the page.'),
          prop('options', 'readonly SegmentedOption[]', 'The segments; they wrap onto more lines when there is not room.'),
          prop('value', 'string', 'The chosen option\'s value.'),
          prop('onChange', '(value) => void', 'Another segment was chosen (click, or the arrow keys).'),
          prop('disabled', 'boolean', 'Stops answering presses and keeps the chosen segment readable (a view-only page still shows the value).', 'false'),
          prop('className', 'string', 'Layout only (margin, alignment).'),
        ],
      },
      {
        name: 'SegmentedOption', source: `${DS}/SegmentedControl.tsx`, own: 'SegmentedOption',
        props: [
          prop('value', 'string', 'What onChange gives back.'),
          prop('label', 'string', 'The words on the segment.'),
          prop('quiet', 'boolean', 'Reads grey, not teal, while chosen: for the choice that means "nothing" ("Off").'),
        ],
      },
    ],
  },
  ReadOnlyNote: {
    name: 'ReadOnlyNote',
    importFrom: UI,
    use: 'a page or a card can be read and not changed: a lock and the page\'s words ("View only"), read out as a note where it stands. An (i) after the words says who can change it. For the `meta` of a page head or the `actions` of a SectionCard.',
    dont: 'Do not leave the controls looking editable beside it: the fields are read-only (full-contrast words on grey) and the save bar is gone. It is a line of facts, not a banner.',
    parts: [
      {
        name: 'ReadOnlyNote', source: `${DS}/ReadOnlyNote.tsx`, own: 'ReadOnlyNoteProps',
        props: [prop('children', 'ReactNode', 'The words ("View only"), then an InfoTip if there is more to say.')],
      },
    ],
  },
  StatTile: {
    name: 'StatTile',
    importFrom: UI,
    use: 'a page opens with the numbers that matter: one tile each, with a 24px figure, what it counts, a line of facts, an (i) for what it rests on and, when the figure opens the records behind it, a link. Five states that never read alike: the figure, "Not recorded", loading, failed and "No access".',
    dont: 'Do not pass 0 for a figure that failed to load, was refused or that nothing recorded (pass `error`, `denied`, `loading` or `value={null}`: a 0 is a number the person will believe), do not make the whole tile a button (its (i) and its link are controls of their own), and do not write a sentence in `note`: facts.',
    parts: [
      {
        name: 'StatTile', source: `${DS}/StatTile.tsx`, own: 'StatTileProps',
        props: [
          prop('label', 'string', 'What the figure is ("Open reviews"): 12px, above it.'),
          prop('value', 'string | null', 'The figure as text (formatCount(n)). null means nothing is recorded: the tile says "Not recorded", never 0.'),
          prop('unit', 'string', 'What the figure counts, after it: "documents".'),
          prop('note', 'ReactNode', 'A line of facts under the figure: "3 archived", "32 of 41 documents mapped". It may hold a link.'),
          prop('info', 'string', 'What the figure rests on, from an (i) beside the label. With no figure (value null) it says why there is none, beside "Not recorded".'),
          prop('link', '{ href; label }', 'The figure opens the records behind it. The label is what a screen reader says for the link ("41 documents. Open the library"): it is required with the link.'),
          prop('tone', "'default' | 'success' | 'warning' | 'danger'", 'The colour of the figure: danger for something wrong, success for something done.', "'default'"),
          prop('progress', 'number | null', 'A bar under the figure, 0 to 100, for a figure that is a share. It is a ProgressBar named by the label; null draws none.'),
          prop('denied', 'boolean', 'The person may not see this figure: "No access" with a lock, and the (i) says why. It wins over `loading`, `error` and `value`: nothing is waited for, retried or shown. Never draw a refused figure as 0 or as "Not recorded".', 'false'),
          prop('loading', 'boolean', 'The request has not answered: a skeleton in place of the figure, announced as "Loading <label>".', 'false'),
          prop('error', '{ title; message?; onRetry? } | null', 'The request failed: what, in the server\'s words, and Retry when trying again can help. Shown in place of the figure; it wins over `loading`.', 'null'),
          prop('children', 'ReactNode', 'More under the figure: pills, links.'),
          CLASS_NAME,
        ],
      },
    ],
  },
  ProgressBar: {
    name: 'ProgressBar',
    importFrom: UI,
    use: 'a share is drawn as a bar: project completion, coverage. A real progressbar (a name, aria-valuenow and the words as aria-valuetext) with the number beside it. It fills the width it is given: set the width with `className`.',
    dont: 'Do not pass 0 for a value that is not recorded (pass null: the bar says so and draws nothing), and do not rely on colour alone: the number is beside the bar. A stored value outside 0-100 fills the track and no more, and the words still say the stored figure.',
    parts: [
      {
        name: 'ProgressBar', source: `${DS}/ProgressBar.tsx`, own: 'ProgressBarProps',
        props: [
          prop('value', 'number | null | undefined', 'A percent: 72 is 72%. null or undefined is not recorded: no bar, a dash, and "<label>: not recorded" for a screen reader.'),
          prop('label', 'string', 'What the bar measures ("Delivery progress"). Read out with the value; never drawn.'),
          prop('valueText', 'string', 'The words beside the bar, instead of the percent ("3 of 5 steps"). The bar is still drawn from `value`.'),
          prop('showValue', 'boolean', 'false draws the bar alone: a tile that already shows the figure.', 'true'),
          prop('tone', "'primary' | 'success' | 'warning' | 'danger'", 'The colour of the fill; each keeps 3:1 against the track.', "'primary'"),
          CLASS_NAME,
        ],
      },
    ],
  },
  ChartFrame: {
    name: 'ChartFrame',
    importFrom: UI,
    imports: ['ChartFrame', 'chartFocusOff'],
    use: 'a recharts chart is drawn: a visible title, the chart in a box of a set height, and its numbers as a table that only a screen reader sees. recharts 3 makes every chart a tab stop announced as an unnamed "application"; the frame hands the chart the props that turn that off, so it is neither a keyboard trap nor a picture without words.',
    dont: 'Do not draw a chart without its numbers: `data` is required, and the table is what a screen reader reads in place of the picture. Do not forget `{...focusOff}` on the chart (and on a Pie) or the chart is a tab stop again, and do not hide a failed or empty request in a chart: say it with ErrorState or EmptyState before you draw a frame.',
    parts: [
      {
        name: 'ChartFrame', source: `${DS}/ChartFrame.tsx`, own: 'ChartFrameProps',
        props: [
          prop('title', 'string', 'What the chart shows, drawn above it ("Documents created and published each month"). It also names the figure and the table of numbers.'),
          prop('note', 'string', 'A line under the title, drawn: the unit, or what to read from the chart.'),
          prop('data', 'ChartData', 'The numbers the chart draws, as a table: the chart\'s text alternative. Read out, never drawn.'),
          prop('height', 'number', 'How tall the chart is, in px. It fills the box: <ResponsiveContainer width="100%" height="100%">.', '240'),
          prop('children', 'ReactNode | (focusOff) => ReactNode', 'The chart. A function receives the props that turn off recharts\' keyboard layer: spread them on the chart, and on a Pie.'),
          CLASS_NAME,
        ],
      },
      {
        name: 'ChartData', source: `${DS}/chartText.ts`, own: 'ChartData',
        props: [
          prop('columns', 'readonly string[]', 'The column names: the first names what each row is (the month, the status), the rest are the numbers drawn ("Created", "Published").'),
          prop('rows', 'ReadonlyArray<readonly (string | number | null | undefined)[]>', 'One row per category, a cell per column. A number is read with its separators and up to two decimals; nothing is "No data", never 0. More than 60 rows are cut and the table says how many were left out.'),
        ],
      },
      {
        name: 'chartFocusOff', fn: true,
        props: [prop('chartFocusOff()', '{ accessibilityLayer: false; rootTabIndex: -1 }', 'The props that turn off recharts 3\'s keyboard layer: accessibilityLayer on the chart (no tab stop, no "application" role) and rootTabIndex on a Pie (its group is a tab stop of its own). A fresh object each call.')],
      },
    ],
  },
  InfoTip: {
    name: 'InfoTip',
    importFrom: UI,
    use: 'an explanation helps the person who wonders and is not needed to avoid a mistake: a small (i) that shows it on hover, focus or tap (Escape and scrolling close it). The words are always in the page for a screen reader. FormField, PageHeader, SectionCard and EmptyState draw one from their `info`.',
    dont: 'Do not put text that prevents a mistake in an (i): that stays on the page as a hint. The press area is 24px with a mouse and 44px on a touch screen around the 20px glyph, without moving anything: do not wrap it in a positioned box (that would paint over its neighbours).',
    parts: [
      {
        name: 'InfoTip', source: 'src/components/ui/InfoTip.tsx',
        props: [
          prop('text', 'string', 'The explanation.'),
          prop('label', 'string', 'What a screen reader says for the button.', "'More information'"),
          prop('align', "'start' | 'end'", 'Which edge of the (i) the note lines up with (either way it is kept on screen).', "'start'"),
          prop('className', 'string', 'Layout only.'),
        ],
      },
    ],
  },
  AnimatedModal: {
    name: 'AnimatedModal',
    importFrom: UI,
    use: 'a centred dialog is needed. Focus moves in when it opens, Tab wraps inside, Escape closes, and focus goes back to what opened it. Stacked overlays (a preview over a drawer) close one layer per Escape: the top one, the one that holds focus; a list or a menu that is open takes the press first.',
    dont: 'Do not forget `dirty` when the dialog holds typed input: without it Escape and the X throw the input away. (Legacy look; the kit\'s ConfirmDialog is built on it.)',
    parts: [
      {
        name: 'AnimatedModal', source: `${UIDIR}/AnimatedModal.tsx`, own: 'AnimatedModalProps',
        props: [
          prop('isOpen', 'boolean', 'Open or shut.'),
          prop('onClose', '() => void', 'Escape, the X, a press outside (when allowed) and Discard.'),
          prop('title', 'ReactNode', 'Names the dialog.'),
          prop('subtitle', 'ReactNode', 'Describes the dialog.'),
          prop('headerAccessory', 'ReactNode', 'Beside the X.'),
          prop('footer', 'ReactNode', 'The action row.'),
          prop('size', "'md' | 'lg' | 'xl' | '2xl' | '3xl'", 'Width.', "'xl'"),
          prop('children', 'ReactNode', 'The body; it scrolls.'),
          prop('bareHeader', 'boolean', 'The caller draws its own header (then pass labelledBy).', 'false'),
          prop('className', 'string', 'On the dialog panel.'),
          prop('labelledBy', 'string', 'With bareHeader: the id of the element that names the dialog.'),
          prop('describedBy', 'string', 'With bareHeader: the id of the element that describes it.'),
          prop('closeOnBackdrop', 'boolean', 'False: a press on the dim area does nothing, not even ask.', 'true'),
          prop('dirty', 'boolean', 'The caller holds typed input: Escape, the X and a press outside show "Discard changes?" first.', 'false'),
          prop('discardLabel', 'string', 'The destructive button of the bar.', "'Discard'"),
          prop('keepLabel', 'string', 'The safe button of the bar.', "'Keep editing'"),
        ],
      },
    ],
  },
  RightSlidePanel: {
    name: 'RightSlidePanel',
    importFrom: UI,
    use: 'a record\'s detail or a long form should sit in a drawer on the right and keep the list in view. Same focus rules as the dialog, and the same Escape: a dialog opened from the drawer closes first, the drawer on the next press.',
    dont: 'Do not forget `dirty` when the panel holds typed input; a full-width drawer on a phone has no backdrop to press.',
    parts: [
      {
        name: 'RightSlidePanel', source: `${UIDIR}/RightSlidePanel.tsx`, own: 'RightSlidePanelProps',
        props: [
          prop('isOpen', 'boolean', 'Open or shut.'),
          prop('onClose', '() => void', 'Escape, the X, a press on the backdrop (when allowed) and Discard.'),
          prop('title', 'ReactNode', 'Names the panel.'),
          prop('subtitle', 'string', 'Describes the panel.'),
          prop('children', 'ReactNode', 'The body; it scrolls.'),
          prop('width', 'string', 'A width class.', "'w-full max-w-xl'"),
          prop('widthClassName', 'string', 'Deprecated alias of width.'),
          prop('footer', 'ReactNode', 'The action row.'),
          prop('closeOnBackdrop', 'boolean', 'False: a press on the backdrop does nothing, not even ask.', 'true'),
          prop('dirty', 'boolean', 'The caller holds typed input: Escape, the X and the backdrop show "Discard changes?" first.', 'false'),
          prop('discardLabel', 'string', 'The destructive button of the bar.', "'Discard'"),
          prop('keepLabel', 'string', 'The safe button of the bar.', "'Keep editing'"),
        ],
      },
    ],
  },
  DiscardBar: {
    name: 'DiscardBar',
    importFrom: UI,
    imports: ['DiscardBar', 'useDiscardGuard'],
    use: 'a page-level guard needs the "Discard changes?" bar the two overlays show when `dirty`.',
    parts: [
      {
        name: 'DiscardBar',
        props: [
          prop('message', 'string', 'The question.', "'Discard changes?'"),
          prop('keepLabel', 'string', 'The safe button; it takes focus.', "'Keep editing'"),
          prop('discardLabel', 'string', 'The destructive button.', "'Discard'"),
          prop('onKeep', '() => void', 'Go back to editing.'),
          prop('onDiscard', '() => void', 'Throw the input away.'),
        ],
      },
      {
        name: 'useDiscardGuard', fn: true,
        props: [prop('useDiscardGuard({ open, dirty, closeOnBackdrop, onClose, dialogRef })', '{ asking, requestClose(source), keep(), discard() }', 'The state and the focus behind the bar: AnimatedModal and RightSlidePanel use it, and so does an overlay of your own. requestClose decides whether Escape, the X or a press outside closes, asks, or goes back to editing.')],
      },
    ],
  },
  ConfirmDialog: {
    name: 'ConfirmDialog',
    importFrom: UI,
    imports: ['useConfirm', 'ConfirmDialog'],
    use: 'a destructive or far-reaching action needs asking first, instead of window.confirm: `await confirm({...})` resolves true or false exactly once. A danger question puts focus on Cancel.',
    dont: 'Do not write "OK": `confirmLabel` is the verb phrase of what will happen ("Archive 3 documents"). Do not render the dialog yourself; put `confirmDialog` in your JSX.',
    parts: [
      {
        name: 'useConfirm', fn: true,
        props: [prop('const { confirm, confirmDialog } = useConfirm()', '{ confirm(options): Promise<boolean>, confirmDialog }', 'Render `confirmDialog` once in your JSX. confirm() resolves true on the action; Cancel, Escape, a click outside, a newer question and the page going away are all false.')],
      },
      {
        name: 'ConfirmDialog', source: `${DS}/ConfirmDialog.tsx`, own: 'ConfirmDialogProps',
        props: [
          prop('open', 'boolean', 'Open or shut (useConfirm holds it for you).'),
          prop('onConfirm', '() => void', 'The action button was pressed.'),
          prop('onCancel', '() => void', 'Cancel, Escape and a click on the backdrop.'),
          inherited(prop('…ConfirmRequest', 'title, message, confirmLabel, cancelLabel, tone', 'The question itself: see ConfirmRequest below.')),
        ],
      },
      {
        name: 'ConfirmRequest', source: `${DS}/ConfirmDialog.tsx`, own: 'ConfirmRequest',
        props: [
          prop('title', 'string', 'The question.'),
          prop('message', 'ReactNode', 'A few words more.'),
          prop('confirmLabel', 'string', 'What the button does, as a verb phrase. No default.'),
          prop('cancelLabel', 'string', 'The other button.', "'Cancel'"),
          prop('tone', "'default' | 'danger'", 'danger makes the action red and puts focus on Cancel.', "'default'"),
        ],
      },
    ],
  },
  useNotify: {
    name: 'useNotify',
    importFrom: UI,
    use: 'the person needs to be told what happened: notify.success goes by itself after 3 seconds; notify.error stays until dismissed, says what the server said (cleaned) and can carry a Retry. Toasts wait while they are being read.',
    dont: 'Do not toast a success before the server has answered (useReportedMutation does it in the right order), and do not show a raw error object: pass the caught error and the helper cleans it.',
    parts: [
      {
        name: 'useNotify', fn: true,
        props: [
          prop('notify.success(message, options?)', 'string', 'A quick action went through; goes by itself after 3 seconds.'),
          prop('notify.error(errorOrMessage, options?)', 'string', 'Something failed: pass the caught error (or a sentence). Never goes by itself.'),
          prop('notify.warning(message, options?)', 'string', 'Needs a look; the toast default duration.'),
          prop('notify.info(message, options?)', 'string', 'FYI; the toast default duration.'),
        ],
      },
      {
        name: 'NotifyOptions', source: 'src/components/ui/ds/reportOutcome.ts', own: 'NotifyOptions',
        props: [
          prop('title', 'string', 'A headline; the message then reads as its detail.'),
          prop('duration', 'number', 'Milliseconds; a confirmation defaults to 3000.'),
          prop('action', 'ToastAction', 'A button on the toast ({ label, onClick }).'),
        ],
      },
      {
        name: 'NotifyErrorOptions', source: 'src/components/ui/ds/reportOutcome.ts', own: 'NotifyErrorOptions',
        props: [
          prop('title', 'string', 'The headline.', "'Something went wrong'"),
          prop('fallback', 'string', 'Said when the server said nothing usable.'),
          prop('retry', '() => void', 'Adds a Retry button that calls it.'),
        ],
      },
    ],
  },
  SidePanel: {
    name: 'SidePanel',
    importFrom: UI,
    use: 'a record, a queue or a set of tools sits beside the page it belongs to (the library drawer, the Work-and-context panel, a meeting panel). From 1440 px it docks as a column and the content shrinks; from 640 px it is an overlay with a scrim and a focus trap; below that it is a bottom sheet. You write one panel, not three.',
    dont: 'Do not choose the layout from the window width yourself: the panel does. Put a docked panel as the last child of a flex row whose other child is the content with `min-w-0 flex-1`. Do not keep state inside it that must survive a resize across 640 px or the dock width (the content is drawn again): keep it in the page. A panel that is never a column is a `Sheet` (or `dockFrom={Infinity}`).',
    parts: [
      {
        name: 'SidePanel', source: `${DS}/SidePanel.tsx`, own: 'SidePanelProps',
        props: [
          prop('open', 'boolean', 'Open or shut. Shut draws nothing.'),
          prop('onClose', '() => void', 'Close was asked for and nothing is left to lose: the X, Escape, the scrim, or Discard on the "Discard changes?" bar.'),
          prop('title', 'ReactNode', 'The panel\'s name: its heading, and what names the dialog (or the complementary region when docked) for a screen reader.'),
          prop('subtitle', 'ReactNode', 'A line under the title.'),
          prop('actions', 'ReactNode', 'Controls in the header before the close button (a Menu, previous and next).'),
          prop('children', 'ReactNode', 'The body: it scrolls inside the panel.'),
          prop('footer', 'ReactNode', 'A row of buttons under the body ("Show 12 documents"); it stays in view while the body scrolls.'),
          prop('dockFrom', 'number', 'The window width from which the panel docks as a column. `Infinity` never docks. Under 640 px it is a sheet whatever this says.', '1440'),
          prop('width', "'sm' | 'md' | 'lg'", '360, 480 or 640 px: the width of the docked column and of the overlay. The sheet is as wide as the window up to 640 px, then centred at 640 px.', "'md'"),
          prop('mode', "'docked' | 'overlay' | 'sheet'", 'Force a mode instead of following the window width (a specimen, a panel that is always a sheet).'),
          prop('padded', 'boolean', 'Padding around the body. Turn it off for a body made of lists that run edge to edge.', 'true'),
          prop('dirty', 'boolean', 'The caller holds typed input: the X, Escape and the scrim ask "Discard changes?" first (every mode).', 'false'),
          prop('discardLabel', 'string', 'The destructive button of the bar.', "'Discard'"),
          prop('keepLabel', 'string', 'The safe button of the bar.', "'Keep editing'"),
          prop('closeOnBackdrop', 'boolean', 'False: a press on the scrim does nothing, not even ask.', 'true'),
          prop('initialFocus', 'string | RefObject<HTMLElement>', 'What takes focus when the panel opens: a CSS selector inside it, or a ref. Default: the first field, else the first button. A docked column takes no focus unless this is given.'),
          prop('restoreFocus', 'RefObject | () => HTMLElement | null', 'Where focus goes when the panel closes and focus is lost with it: a ref, or a function that finds the element then (the row the panel was opened from, drawn again since). Default: what opened the panel.'),
          prop('escapeClosesDocked', 'boolean', 'Docked only: Escape pressed inside the column closes it. An overlay and a sheet always close on Escape, and only the top layer does.', 'false'),
          prop('closeLabel', 'string', 'The close button\'s name.', "'Close panel'"),
          prop('className', 'string', 'Layout only (a margin on the docked column).'),
        ],
      },
    ],
  },
  Sheet: {
    name: 'Sheet',
    importFrom: UI,
    use: 'a task opens over the page and is done there: the filter sheet of a phone with its "Show 124 documents" footer, a view picker, a wide sheet from the right to manage a record. It is a SidePanel that never docks, so it has the same scrim, focus trap, locked page scroll, Escape and `dirty` guard.',
    dont: 'Do not use it for something that should sit beside the page on a wide window (that is a SidePanel). Put the primary action of a phone sheet in `footer`, so it stays in reach while the body scrolls.',
    parts: [
      {
        name: 'Sheet', source: `${DS}/Sheet.tsx`, own: 'SheetProps',
        props: [
          prop('open', 'boolean', 'Open or shut.'),
          prop('onClose', '() => void', 'Close was asked for and nothing is left to lose.'),
          prop('title', 'ReactNode', 'The sheet\'s name (its heading and the dialog\'s name).'),
          prop('subtitle', 'ReactNode', 'A line under the title.'),
          prop('actions', 'ReactNode', 'Controls in the header before the close button.'),
          prop('children', 'ReactNode', 'The body: it scrolls inside the sheet.'),
          prop('footer', 'ReactNode', 'The action row under the body; it stays in view.'),
          prop('side', "'auto' | 'right' | 'bottom'", 'auto: a sheet from the right at 640 px and up, a bottom sheet under that. right and bottom force one.', "'auto'"),
          prop('width', "'sm' | 'md' | 'lg'", '360, 480 or 640 px: the width of the right-hand sheet.', "'md'"),
          prop('padded', 'boolean', 'Padding around the body.', 'true'),
          prop('dirty', 'boolean', 'The caller holds typed input: closing asks first.', 'false'),
          prop('discardLabel', 'string', 'The destructive button of the bar.', "'Discard'"),
          prop('keepLabel', 'string', 'The safe button of the bar.', "'Keep editing'"),
          prop('closeOnBackdrop', 'boolean', 'False: a press on the scrim does nothing.', 'true'),
          prop('initialFocus', 'string | RefObject<HTMLElement>', 'What takes focus when it opens: a selector inside it, or a ref.'),
          prop('restoreFocus', 'RefObject | () => HTMLElement | null', 'Where focus goes when it closes; default: what opened it.'),
          prop('closeLabel', 'string', 'The close button\'s name.', "'Close panel'"),
        ],
      },
    ],
  },
  FilterChips: {
    name: 'FilterChips',
    importFrom: UI,
    use: 'a register or a home page offers a few quick filters, each with the number of records it would show: "Mine 12", "Review overdue 3", a committee with a live dot and an overdue badge. A chip is a toggle (`aria-pressed`); the row has one tab stop and the arrow keys; the count is the true number ("1,247", never "99+").',
    dont: 'Do not use it for choosing a page of a record (that is Tabs) or for one value out of a short list in a form (SegmentedControl). Do not signal a state with the flag\'s colour alone: `flag.label` is required and is what a screen reader reads. Do not put a chip\'s count in its label: pass `count`, so it is formatted and announced the same everywhere.',
    parts: [
      {
        name: 'FilterChips', source: `${DS}/FilterChips.tsx`, own: 'FilterChipsProps',
        props: [
          prop('chips', 'FilterChip[]', 'The chips, in order.'),
          prop('onToggle', '(key) => void', 'A chip was pressed (click, Enter, Space): its key. The page flips `active`; an arrow key never toggles.'),
          prop('label', 'string', 'Names the row (a toolbar) for a screen reader: "Quick views".'),
          prop('overflow', "'wrap' | 'scroll'", 'wrap: more lines when the chips do not fit. scroll: one line that scrolls sideways, with room around the chips for their focus ring.', "'wrap'"),
          prop('maxVisible', 'number', 'Show at most this many chips; the rest go to a "+N more" menu whose items are checks with their counts. The trigger says how many of them are on ("+5 more · 1 on"). A cut that would leave one chip in the menu is not made.'),
          CLASS_NAME,
        ],
      },
      {
        name: 'FilterChip', source: `${DS}/FilterChips.tsx`, own: 'FilterChip',
        props: [
          prop('key', 'string', 'Identity; what onToggle receives.'),
          prop('label', 'string', 'What the chip says. A label that does not fit is cut and gives its whole text as a tooltip then.'),
          prop('count', 'number | null', 'The number of records the chip would show, true ("1,247"). Missing: none is drawn. 0 is a count.'),
          prop('active', 'boolean', 'On (`aria-pressed`, filled). The page holds it.'),
          prop('flag', 'ChipFlag', 'A mark: a dot before the label, or a small badge after the count when it has `text`.'),
          prop('icon', 'LucideIcon', 'A small icon before the label.'),
          prop('disabled', 'boolean', 'Shown, cannot be toggled; the arrow keys skip it.'),
          prop('hidden', 'boolean', 'Not shown at all.'),
          prop('title', 'string', 'A tooltip of your own for the whole chip. A screen reader reads it as the chip\'s description after its name, so say something the name does not. A label that is cut and a flag\'s mark carry their own tooltips: leave this out for them.'),
        ],
      },
      {
        name: 'ChipFlag',
        props: [
          prop('tone', "'info' | 'warning' | 'danger' | 'success'", 'The colour of the dot or badge (white words on it).'),
          prop('text', 'string | number', 'With it the flag is a badge ("3"); without it, a dot.'),
          prop('label', 'string', 'The words for a screen reader and the tooltip ("3 overdue actions", "meeting in progress"). Required: a flag is never colour alone.'),
        ],
      },
    ],
  },
  Disclosure: {
    name: 'Disclosure',
    importFrom: UI,
    imports: ['Disclosure', 'AccordionRow'],
    use: 'a header opens and shuts a panel. Disclosure is a facet group of a filter rail (its name, how many are chosen in it, a search slot); AccordionRow is a row of a list that opens in place (an agenda item: a number, a title, a line of facts, a status). Both are the accessible accordion: a button in a heading with `aria-expanded` and `aria-controls`, and a panel that is a region named by it.',
    dont: 'Do not put a button, a link or a menu in `trailing` of an AccordionRow: it is inside the header button. Do not remove the panel to hide it (the kit hides it, so what was typed inside survives). Pass `region={false}` in a stack of more than about six, so the page does not get a landmark per row.',
    parts: [
      {
        name: 'Disclosure', source: `${DS}/Disclosure.tsx`, own: 'DisclosureProps',
        props: [
          prop('label', 'string', 'The group\'s name: the text of the header.'),
          prop('count', 'number | null', 'How many are chosen in the group: a filled number after the name, followed for a screen reader by `countLabel` ("Status 2 selected"). 0 and missing draw nothing.'),
          prop('countLabel', 'string', 'The word that follows the number for a screen reader.', "'selected'"),
          prop('search', 'ReactNode', 'A search box (or any control) at the top of the open group.'),
          prop('open', 'boolean', 'Controlled: the page holds the open state.'),
          prop('defaultOpen', 'boolean', 'Uncontrolled: whether it starts open.', 'false'),
          prop('onOpenChange', '(open) => void', 'A press asks for this state (controlled or not).'),
          prop('level', '2 | 3 | 4 | 5 | 6', 'The heading level of the header.', '3'),
          prop('region', 'boolean', 'The panel is a `region` named by the header. Pass false in a long stack.', 'true'),
          prop('disabled', 'boolean', 'Shown, cannot be opened or shut.', 'false'),
          prop('children', 'ReactNode', 'The group: the options, the list.'),
          CLASS_NAME,
        ],
      },
      {
        name: 'AccordionRow', source: `${DS}/Disclosure.tsx`, own: 'AccordionRowProps',
        props: [
          prop('title', 'string', 'The row\'s title: cut at two lines in the header. A title over 80 characters is repeated in full at the top of the open row, so the whole value is one press away.'),
          prop('meta', 'ReactNode', 'A line under the title ("Presenter · 15 min").'),
          prop('lead', 'ReactNode', 'Before the title: a number badge, an icon. It is part of the header\'s name (a number is read: "3 Review the minutes"); hide an icon with aria-hidden, not a number. The open panel lines up under the title when there is one.'),
          prop('trailing', 'ReactNode', 'After the title: a status pill, a count. Inside the header button, so never interactive. When it does not fit beside the title it drops to the next line (the title keeps at least 10rem).'),
          prop('open', 'boolean', 'Controlled: the page holds the open state.'),
          prop('defaultOpen', 'boolean', 'Uncontrolled: whether it starts open.', 'false'),
          prop('onOpenChange', '(open) => void', 'A press asks for this state (controlled or not).'),
          prop('level', '2 | 3 | 4 | 5 | 6', 'The heading level of the header.', '3'),
          prop('region', 'boolean', 'The panel is a `region` named by the header. Pass false in a long stack.', 'true'),
          prop('disabled', 'boolean', 'Shown, cannot be opened or shut.', 'false'),
          prop('children', 'ReactNode', 'What opens: the description, the votes, the actions.'),
          CLASS_NAME,
        ],
      },
    ],
  },
  WorkRow: {
    name: 'WorkRow',
    importFrom: UI,
    imports: ['WorkRow'],
    use: 'a worklist lists pieces of work somebody has to do (the Overview\'s "Needs my action", the work-and-context panel, the inbox page, the committees\' action lane): what KIND of work it is (a pill with its word), the title (two lines, then cut; the whole text is the tooltip when cut), a context line, who asked, when it is due in words ("Overdue by 3 days", "Due today", "Due 12 Nov 2026") and ONE action. The title is the row\'s one tab stop, stretched over the whole row; the action, the menu and the tick are the only other stops. Rows go in a `<ul>`.',
    dont: 'Do not put a link or a control in `context` (it sits under the row\'s own click: use `action` or `menu`), a second primary action (the rest goes in `menu`), or the due words in `context` (pass `due`). Pass `due={null}` for work that has no date and leave `due` out for work that has no date concept at all. Do not name the action "Open" fifty times and hope: its accessible name is "<label>: <title>" already. A server flag that says overdue goes in `overdue`; never colour the title.',
    parts: [
      {
        name: 'WorkRow', source: `${DS}/WorkRow.tsx`, own: 'WorkRowProps',
        props: [
          prop('kind', '{ label; tone? }', 'What sort of work: a pill with its word ("To approve", "Review due"). `tone` is the pill\'s colour (neutral when left out); take it from a status registry.'),
          prop('title', 'string', 'What the work is about. Two lines, then cut with the whole text as the tooltip; always whole in the accessible name.'),
          prop('href', 'string', 'The title is a link to this address, stretched over the whole row (one big target, one tab stop).'),
          prop('onOpen', '() => void', 'Or the title is a button that runs this (opens a dialog or a panel). `href` wins when both are given; with neither, the title is plain text.'),
          prop('context', 'ReactNode', 'One muted line under the title ("Policy · v2.1 · ISO 27001 +2"): text, up to two lines. Not a place for links.'),
          prop('requester', '{ name?; role? }', 'Who asked or who owns it: avatar and name, "Unassigned" when `name` is empty. `role` is a word before them ("Asked by").'),
          prop('due', 'DateInput', 'When it is due. Left out: no due slot. `null` (or an unreadable date): "No due date". Words: Overdue by N days, Due today, Due tomorrow, Due in 2-7 days, Due 12 Nov 2026.'),
          prop('calendar', 'boolean', '`due` means a day although it arrives as a DateTime: the day as written, whatever the viewer\'s zone.', 'false'),
          prop('overdue', 'boolean', 'The server\'s own flag: `true` forces "Overdue" (an SLA breached with the date still ahead), `false` never flags (a finished action). Left out: a day in the past is overdue.'),
          prop('action', 'WorkAction', 'The row\'s one action: a button or a link above the stretched title.'),
          prop('menu', '{ label?; items: MenuItem[] }', 'A secondary menu after the action (an icon-only "…"). `label` names it; default "Actions for <title>".'),
          prop('check', 'WorkCheck', 'A tick before the kind ("done"): a 32px target, 44px on a phone, named by `label`.'),
          prop('compact', 'boolean', 'Stack the row at any width. For a docked 360px panel: from 640px a row is a grid, and this stack has no container queries.', 'false'),
          prop('as', "'li' | 'div'", 'The element: a list item (put rows in a `<ul>`) or a div outside a list.', "'li'"),
          CLASS_NAME,
        ],
      },
      {
        name: 'WorkAction', source: `${DS}/WorkRow.tsx`, own: 'WorkAction',
        props: [
          prop('label', 'string', 'The word on the button. Its accessible name is "<label>: <title>" unless `ariaLabel` is given.'),
          prop('href', 'string', 'The button is a link to this address.'),
          prop('onClick', '() => void', 'Or it runs this. `href` wins when both are given.'),
          prop('loading', 'boolean', 'The request is running: aria-busy, and a press does nothing.', 'false'),
          prop('variant', "'primary' | 'secondary'", 'primary for the one thing the person is here for.', "'secondary'"),
          prop('ariaLabel', 'string', 'The page\'s own name for the button; it must contain `label` (WCAG 2.5.3).'),
        ],
      },
      {
        name: 'WorkCheck', source: `${DS}/WorkRow.tsx`, own: 'WorkCheck',
        props: [
          prop('checked', 'boolean', 'Ticked or not. The page holds it.'),
          prop('onChange', '(checked) => void', 'The tick was pressed; the page sends the change and flips `checked` when the server has answered.'),
          prop('label', 'string', 'Names the tick for a screen reader: "Mark completed: Review the minutes".'),
          prop('disabled', 'boolean', 'Shown, cannot be changed (a read-only person).', 'false'),
        ],
      },
    ],
  },
  CountRow: {
    name: 'CountRow',
    importFrom: UI,
    imports: ['CountRow'],
    use: 'a label and the TRUE number of records behind it open them: the Overview\'s counters ("Overdue reviews 12"), the attention list of a module. One target, one tab stop. `row` is a line of a list (dot, label, count, chevron); `chip` is a pill for a wrapped strip. A count of 0 is muted with a hollow dot and stays a target. A change beside the count is words ("+3 this week").',
    dont: 'Do not cap the count ("99+") or pass 0 for a request that failed or a figure nobody recorded (pass `null`, `error` or `loading`). Do not colour the change: only the page knows whether up is bad. Do not put a second control in the row; with `error` the row is the label and its own Retry, not one target. Do not use it for a figure the person reads rather than opens: that is a StatTile.',
    parts: [
      {
        name: 'CountRow', source: `${DS}/CountRow.tsx`, own: 'CountRowProps',
        props: [
          prop('label', 'string', 'What is counted: "Overdue reviews".'),
          prop('count', 'number | null', 'The true total, with its separator (1,247). `null`: nothing is recorded: a dash, read as "not recorded", never 0.'),
          prop('href', 'string', 'The row opens the records behind the count. One target.'),
          prop('onClick', '() => void', 'Or it runs this (a button). `href` wins when both are given; with neither the row is plain text.'),
          prop('delta', 'number | null', 'The change since the page\'s reference point, drawn as words with a sign after the count: "+3 this week".'),
          prop('deltaLabel', 'string', 'What the change is measured against: "this week".'),
          prop('tone', 'Tone', 'The colour of the dot: danger for what is wrong. A count of 0 or none has a hollow dot whatever the tone.', "'neutral'"),
          prop('layout', "'row' | 'chip'", 'row: a line of a list. chip: a pill (dot, count, label) for a wrapped strip.', "'row'"),
          prop('loading', 'boolean', 'The request has not answered: a skeleton, announced as "Loading <label>".', 'false'),
          prop('error', '{ onRetry? } | null', 'The request failed: "<label>: unavailable", and a Retry when `onRetry` is given.', 'null'),
          prop('as', "'li' | 'div'", 'The element: a list item or a div outside a list.', "'li'"),
          CLASS_NAME,
        ],
      },
    ],
  },
  ClampedText: {
    name: 'ClampedText',
    importFrom: UI,
    use: 'a description, a rationale or a note can be long: it shows its first few lines and "Show more" opens the rest, the whole value one keyboard press away. Whether it is cut is measured, so a text that fits has no button and a wider window takes the button away. Line breaks are kept; the text is read in its own direction (Arabic beside English); a missing text is the dash.',
    dont: 'Do not cut the text yourself with a character count (a count does not know the width), or hide the rest behind a tooltip a keyboard cannot reach. Do not use it for a title (TitleLink cuts at two lines) or for a list of names (ChipList).',
    parts: [
      {
        name: 'ClampedText', source: `${DS}/ClampedText.tsx`, own: 'ClampedTextProps',
        props: [
          prop('text', 'string | null', 'The text; line breaks are kept. Missing or blank: a dash.'),
          prop('lines', 'number', 'Lines shown while it is shut, 1 to 6.', '3'),
          CLASS_NAME,
        ],
      },
    ],
  },
  ChipList: {
    name: 'ChipList',
    importFrom: UI,
    use: 'a record has related records (its frameworks, its owners, its linked assets): the first two as chips and a "+N" that opens ALL of them in a small dialog (links where an item has an address, a search box from eight items). The rule for related records everywhere: the first two and "+N", never a count that hides the names. Enter or Space on "+N" opens the list and moves focus in, Tab stays inside, Escape closes it and gives focus back; a press outside, a scroll or a resize closes it.',
    dont: 'Do not write the count yourself ("3 frameworks") and do not show every chip and let the row grow: the row would change height with the data. Do not use it for people (PersonStack draws avatars). `label` is a plural noun in lower case: it makes "+3 more frameworks" and "All frameworks" for a screen reader.',
    parts: [
      {
        name: 'ChipList', source: `${DS}/ChipList.tsx`, own: 'ChipListProps',
        props: [
          prop('items', '(string | ChipListItem)[]', 'The items: a name, or { label, href } for a link. A blank one is left out; none draws nothing.'),
          prop('label', 'string', 'What the items are, a plural noun in lower case ("frameworks"): it names the list, the "+N" and the full list.'),
          prop('shown', 'number', 'Chips shown before the "+N".', '2'),
          prop('searchFrom', 'number', 'The full list has a search box from this many items (every word of the query in the name, any case, no accents).', '8'),
          CLASS_NAME,
        ],
      },
      {
        name: 'ChipListItem', source: `${DS}/chipListModel.ts`, own: 'ChipListItem',
        props: [
          prop('label', 'string', 'The name.'),
          prop('href', 'string', 'The item is a link to this address, in the chip and in the full list.'),
        ],
      },
    ],
  },
  Fact: {
    name: 'Fact',
    importFrom: UI,
    imports: ['Fact', 'FactList'],
    use: 'the details of a record, or a band of figures: a label over its value, in a grid that fills the width with as many columns as fit (one on a phone, four on a wide window, no breakpoints). A fact with no value says so ("—", or "Not set" where the person can set it), never a blank. A long value wraps, an unbroken word too.',
    dont: 'Always put Facts inside a FactList: a Fact alone is a `<div>` without its `<dl>`. Do not use it for a form (that is FormField) or for many records (RegisterTable). Do not pass 0, "None" or "N/A" for no value: leave the child out and let `empty` say it.',
    parts: [
      {
        name: 'Fact', source: `${DS}/Facts.tsx`, own: 'FactProps',
        props: [
          prop('label', 'string', 'What the value is: "Owner". 12px, muted, above it.'),
          prop('children', 'ReactNode', 'The value. Left out, empty or false: `empty` is drawn in muted words.'),
          prop('empty', 'string', 'What to say when there is no value: the dash (not recorded) or "Not set" (the person can set it).', "'—'"),
        ],
      },
      {
        name: 'FactList', source: `${DS}/Facts.tsx`, own: 'FactListProps',
        props: [
          prop('children', 'ReactNode', 'The Facts.'),
          prop('variant', "'plain' | 'boxed'", 'plain: label over value. boxed: each fact in its own box (a band of figures).', "'plain'"),
          prop('min', 'number', 'The narrowest a column gets, in px: the grid has as many columns as fit.', '160'),
          CLASS_NAME,
        ],
      },
    ],
  },
  TitleLink: {
    name: 'TitleLink',
    importFrom: UI,
    imports: ['TitleLink', 'linkClasses'],
    use: 'a record\'s name is a link (a plan, a drill, a document): it wraps, is cut at two lines (the whole title is the tooltip only when it is cut, and always in the accessible name) and is a 24px target, 44px on a phone, without moving the line it sits in. `linkClasses` gives the same padding and colours to a link inside a sentence or a 12px line: put them on a `<Link>`.',
    dont: 'Do not write the 24px padding trick by hand on a page again, and do not put `line-clamp` on the link itself (its third line shows through the link\'s own padding: the cut is on an inner span). Do not style a link as plain text with no hover and no ring.',
    parts: [
      {
        name: 'TitleLink', source: `${DS}/Links.tsx`, own: 'TitleLinkProps',
        props: [
          inherited(prop('...LinkProps', 'next/link props', 'href, prefetch, onClick and the rest of next/link\'s props pass through.')),
          prop('title', 'string', 'The words of the link: the record\'s name. Cut after `lines`; the whole of it is the tooltip only when it is cut.'),
          prop('lines', 'number', 'Lines before the cut, 1 to 6.', '2'),
          prop('tone', "'title' | 'text' | 'muted'", 'title: dark, the brand colour on hover. text: the brand colour. muted: grey until hovered.', "'title'"),
          prop('size', "'body' | 'label'", 'The size of the line it sits in: 13px (body) or 12px (label). The target padding depends on it.', "'body'"),
          CLASS_NAME,
        ],
      },
      {
        name: 'linkClasses', fn: true,
        props: [prop('linkClasses({ tone?, size? })', 'string', 'The classes of a link in text: its colours, the ring on the link itself, and the padding that makes a 24px target (44px on a phone) with a negative margin that cancels it, so nothing moves.')],
      },
    ],
  },
  CardLink: {
    name: 'CardLink',
    importFrom: UI,
    use: 'a whole card opens something: the card IS the link, so it is one tab stop with the ring on the card and a hover that says it presses. Its name for a screen reader is the card\'s text.',
    dont: 'Do not put a link or a button inside it: an anchor in an anchor is invalid, and a second control would be a second tab stop under the first. For a card with controls inside, stretch the title\'s link over the card as WorkRow does. Do not make a whole card a link when only one word in it should be.',
    parts: [
      {
        name: 'CardLink', source: `${DS}/Links.tsx`, own: 'CardLinkProps',
        props: [
          inherited(prop('...LinkProps', 'next/link props', 'href, prefetch, onClick, aria-label and the rest of next/link\'s props pass through.')),
          prop('padded', 'boolean', 'Padding inside the card (16px). Turn it off for a card whose content brings its own edge-to-edge parts.', 'true'),
          CLASS_NAME,
        ],
      },
    ],
  },
  useReportedMutation: {
    name: 'useReportedMutation',
    importFrom: UI,
    use: 'a page would use a bare useMutation: it confirms only after the server answers ok, and a failure stays on screen with what the server said and a Retry that repeats the same call.',
    dont: 'Do not offer Retry on a create that is not safe to repeat: set `retryable: false`. Retry is withheld by itself for a refusal (4xx other than 408, 425, 429).',
    parts: [
      {
        name: 'useReportedMutation', fn: true,
        props: [prop('useReportedMutation(config)', 'the mutation result', 'The react-query mutation result, unchanged: call .mutate(variables). Needs the ToastProvider and QueryClientProvider the app already has.')],
      },
      {
        name: 'ReportConfig', source: 'src/components/ui/ds/reportOutcome.ts', own: 'ReportConfig',
        props: [
          prop('success', "string | { title, message? } | (data, variables) => either", 'The confirmation: one line, or a headline with a second line under it ({ title: "Settings saved", message: "New requests use them from now on." }); or a function of what the server returned that gives either. Optional: left out where the result is plain to see (a tick stays ticked, the row changes), nothing is said when the server confirms; the failure, the refresh and `onSuccess` are as ever. An explicit blank string still says "Done".'),
          prop('failure', 'string', 'The headline of the failure ("Couldn\'t archive the document").'),
          prop('fallback', 'string', 'Said when the server gave no usable words, instead of "Please try again."; what the server says always wins.'),
          prop('retryable', 'boolean', 'False: never offer Retry.'),
        ],
      },
      {
        name: 'ReportedMutationConfig', source: 'src/components/ui/ds/reportOutcome.ts', own: 'ReportedMutationConfig',
        props: [
          prop('mutationFn', '(variables) => Promise<D>', 'The request.'),
          prop('onSuccess', '(data, variables) => unknown', 'The page\'s own work once the server has confirmed; it runs after the confirmation is shown.'),
          prop('onError', '(error, variables) => unknown', 'The page\'s own work after a failure is shown (or, with toast \'success\' or \'none\', in place of the toast: errorMessage(error) has the cleaned words to show inline).'),
          prop('invalidate', 'ReadonlyArray<readonly unknown[]>', 'Query keys to refresh once the server has confirmed.'),
          prop('toast', "'always' | 'success' | 'errors' | 'none'", "Which outcomes are toasted. always: the confirmation and the failure (what it has always done). success: only the confirmation, for a drawer or a dialog that shows a failure inline, so it says it once, not twice. errors: only the failure, for an action whose success is plain to see. none: the page reports for itself. The refresh and the page's own onSuccess and onError run in every mode.", "'always'"),
        ],
      },
    ],
  },
};
