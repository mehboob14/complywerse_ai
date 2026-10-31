// Pure wiring of one form field: the ids its pieces get, the aria-describedby a control carries, and the ARIA attributes a control takes from the
// FormField around it (or from its own props when it stands alone). FormField.tsx puts this on screen; node --test checks it (fieldA11y.test.ts).

export interface FieldIds {
  /** the control's id, and what the label's `for` points at */
  id: string;
  hintId: string;
  errorId: string;
}

/** The three ids of a field, from one base (React's useId, or the id the page chose). */
export function fieldIds(base: string): FieldIds {
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

type MaybeId = string | false | null | undefined;

/** The value of aria-describedby: the ids that exist, in the order given, joined by a space. `undefined` when there are none, never an empty attribute. */
export function describedBy(...ids: MaybeId[]): string | undefined {
  const present = ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
  return present.length > 0 ? present.join(' ') : undefined;
}

/** What a FormField tells the control inside it (the React context value). */
export interface FieldState {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

/** What a control was given by its own props. */
export interface ControlOwn {
  id?: string;
  invalid?: boolean;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  'aria-required'?: boolean | 'true' | 'false';
}

/** What the control puts on its element. */
export interface ControlA11y {
  id: string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

/**
 * The accessibility attributes of a control, from the field around it (null when it stands alone) and its own props.
 * The field owns the id (the label points at it); both sources describe the control (the field's hint and error first); either source
 * can mark it invalid or required. A "false" never reaches the DOM: the attribute is either true or absent.
 */
export function controlA11y(field: FieldState | null, own: ControlOwn): ControlA11y {
  const flag = (v: unknown) => v === true || (typeof v === 'string' && v !== 'false');
  return {
    id: field?.id ?? own.id,
    'aria-describedby': describedBy(field?.describedBy, own['aria-describedby']),
    'aria-invalid': field?.invalid || own.invalid || flag(own['aria-invalid']) ? true : undefined,
    'aria-required': field?.required || own.required || flag(own['aria-required']) ? true : undefined,
  };
}
