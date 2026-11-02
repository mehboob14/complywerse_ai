'use client';

// TextInput: a single-line field on the design-system tokens. Inside a FormField it takes its id and ARIA wiring from there; on its own it takes
// the same props (id, aria-describedby, invalid, required) and the caller names it (aria-label). `className` goes on the wrapper, for width and
// margin only. Adornments sit inside the box: the left one is decoration (it does not take clicks), the right one may hold a button.
//
// `unit` is a word after the value, inside the box: <TextInput type="number" unit="days" className="w-[160px]" />. The box keeps room for it: the
// word's width is measured, so typed text never runs under it and the box never changes size. A number is right-aligned in tabular figures so
// it ends at the unit, and the spin arrows are hidden (they would sit on the unit; the arrow keys still step). The unit is read out with the
// field, before its hint (describedBy); the visible word is hidden from the reader so it is not said twice. Read-only and disabled keep their look.
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { describedBy } from './fieldA11y';
import { useFieldControl } from './FormField';
import { READ_ONLY, fieldClasses, unitReserve } from './fieldStyles';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** red outline and aria-invalid (a FormField with an error does this by itself) */
  invalid?: boolean;
  leftAdornment?: ReactNode;
  rightAdornment?: ReactNode;
  /** a word after the value, inside the box: "days". With type="number" the digits are right-aligned and tabular. */
  unit?: string;
}

// No warning when a page is rendered on the server: an effect that measures has nothing to do there.
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const NUMBER_WITH_UNIT = 'text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ invalid = false, leftAdornment, rightAdornment, unit, className, ...rest }, ref) {
  const a11y = useFieldControl({
    id: rest.id,
    invalid,
    required: rest.required,
    'aria-describedby': rest['aria-describedby'],
    'aria-invalid': rest['aria-invalid'],
    'aria-required': rest['aria-required'],
  });
  const unitId = `${useId()}-unit`;
  const unitEl = useRef<HTMLSpanElement>(null);
  const [unitWidth, setUnitWidth] = useState<number | null>(null);
  // Before the first paint, and again whenever the word changes size (the font arrives, the page is zoomed): the unit's own layout width, which a
  // CSS transform (a dialog still scaling in) does not change. The first reading is a whole number; the observer's is exact.
  useMeasureEffect(() => {
    const el = unitEl.current;
    if (!el) { setUnitWidth(null); return undefined; }
    setUnitWidth(el.offsetWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => setUnitWidth(entries[0]?.contentBoxSize?.[0]?.inlineSize ?? el.offsetWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [unit]);
  const edge = rightAdornment ? 32 : 12;                                       // where the unit sits: left of the adornment, if there is one
  return (
    <div className={clsx('relative', className)}>
      {leftAdornment && (
        <span className="pointer-events-none absolute inset-y-0 left-[10px] flex items-center text-ds-fg-muted [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:[stroke-width:1.75]">{leftAdornment}</span>
      )}
      <input
        {...rest}
        ref={ref}
        {...a11y}
        aria-describedby={unit ? describedBy(unitId, a11y['aria-describedby']) : a11y['aria-describedby']}
        style={unit ? { ...rest.style, paddingRight: unitReserve(unit, unitWidth, edge) } : rest.style}
        className={clsx(
          fieldClasses(a11y['aria-invalid'] === true), READ_ONLY, 'h-ds-control', leftAdornment ? 'pl-[32px]' : 'pl-[12px]', rightAdornment ? 'pr-[32px]' : 'pr-[12px]',
          unit && 'peer', unit && rest.type === 'number' && NUMBER_WITH_UNIT,
        )}
      />
      {unit && (
        <span ref={unitEl} id={unitId} aria-hidden="true" style={{ right: edge }}
          className="pointer-events-none absolute inset-y-0 flex items-center whitespace-nowrap text-ds-body text-ds-fg-muted peer-disabled:opacity-50">{unit}</span>
      )}
      {rightAdornment && (
        <span className="absolute inset-y-0 right-[8px] flex items-center text-ds-fg-muted [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:[stroke-width:1.75]">{rightAdornment}</span>
      )}
    </div>
  );
});
