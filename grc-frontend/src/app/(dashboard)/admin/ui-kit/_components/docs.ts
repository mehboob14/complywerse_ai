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
          prop('value', 'string', 'The key of the open tab.'),
          prop('onChange', '(key) => void', 'Called when another tab is picked (click, arrow keys, Home, End).'),
          prop('ariaLabel', 'string', 'Names the tab list for a screen reader.'),
          prop('children', 'ReactNode', 'The TabPanels.'),
          CLASS_NAME,
        ],
      },
      {
        name: 'TabItem', source: `${DS}/Tabs.tsx`, own: 'TabItem',
        props: [
          prop('key', 'string', 'Its name in the address.'),
          prop('label', 'string', 'What the tab says.'),
          prop('count', 'number', 'A badge beside the name; 100 and over read "99+"; 0 is a count.'),
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
          prop('noun', 'string', 'What is counted, plural.', "'items'"),
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
    dont: 'Do not put ids in a column `cell` (it is drawn twice, in the table and on the card), and never pass [] for a request that has not answered or has failed: use `loading` and `error`.',
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
          prop('cell', '(row) => ReactNode', 'Drawn in the table and on the card: no ids in it.'),
          prop('priority', '1 | 2 | 3', '1 always; 2 from 768 px; 3 from 1024 px. Cards ignore it.', '1'),
          prop('align', "'left' | 'right' | 'center'", 'Text alignment.'),
          prop('sortable', 'boolean', 'A click on the header sorts (needs onSortChange).'),
          prop('firstDir', "'asc' | 'desc'", 'The direction a first click sorts in.'),
          prop('width', 'string', 'A w-[160px] class written out in full: the preferred width.'),
          prop('isRowHeader', 'boolean', 'The cell names its row (<th scope="row">).'),
          prop('card', "'meta' | 'hide'", 'meta makes it a "label: value" line under the card title; otherwise it is not on the card.'),
          prop('cardLabel', 'string', 'The card line\'s label when the header is not the right word.'),
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
    use: 'a centred dialog is needed. Focus moves in when it opens, Tab wraps inside, Escape closes, and focus goes back to what opened it.',
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
    use: 'a record\'s detail or a long form should sit in a drawer on the right and keep the list in view. Same focus rules as the dialog.',
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
          prop('success', "string | { title, message? } | (data, variables) => either", 'The confirmation: one line, or a headline with a second line under it ({ title: "Settings saved", message: "New requests use them from now on." }); or a function of what the server returned that gives either.'),
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
          prop('onError', '(error, variables) => unknown', 'The page\'s own work after a failure is shown.'),
          prop('invalidate', 'ReadonlyArray<readonly unknown[]>', 'Query keys to refresh once the server has confirmed.'),
        ],
      },
    ],
  },
};
