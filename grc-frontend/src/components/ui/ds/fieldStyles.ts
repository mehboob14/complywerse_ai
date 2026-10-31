// The look TextInput, Textarea and Select share, as one string (kit rules: only the --ds tokens and arbitrary values; recipe in BRIEF_WP5_COMMON.md).
// Invalid swaps the outline colour (never both classes: the ds names are not known to tailwind-merge). Disabled dims and shows the not-allowed cursor.
const BOX = 'block w-full min-w-0 rounded-ds-control border bg-ds-surface text-ds-body text-ds-fg placeholder:text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-not-allowed disabled:bg-ds-surface-subtle disabled:opacity-50';

export function fieldClasses(invalid: boolean): string {
  return `${BOX} ${invalid ? 'border-ds-danger' : 'border-ds-border-control'}`;
}

// Read-only keeps the full-contrast words and only greys the box. For text inputs and textareas only: the :read-only pseudo-class also matches
// every <select> (a select is never "read-write"), so it must not be part of the shared string.
export const READ_ONLY = 'read-only:bg-ds-surface-subtle';
