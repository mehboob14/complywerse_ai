'use client';

// TitleLink and CardLink: the two links the first wave wrote by hand on every page.
//   TitleLink   a record's name that is a link (a plan, a drill): it wraps, is cut at two lines (the whole title is the tooltip only when it is cut) and is a
//               24px target, 44px on a phone, without moving the line it sits in. For a link inside a sentence or a 12px line, put linkClasses(...) on a <Link>.
//   CardLink    a card that IS the link: one tab stop, the ring on the card, a hover that says it presses. The card must not hold a link or a button of its own
//               (an anchor in an anchor is invalid): for a card with controls inside, stretch the title's link over the card instead (see WorkRow).
// Both take next/link's props (href, prefetch, onClick ...). Classes: linkModel.ts.
//
//   <TitleLink href={`/bcm/plans/${plan.id}`} title={plan.name} />
//   <CardLink href="/governance/documents"><h3 className="!text-ds-section !text-ds-fg">Documents</h3><p className="text-ds-body text-ds-fg-muted">41 in force</p></CardLink>
import type { ComponentProps } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { CLAMP_CLASS, clampLines } from './clampModel';
import { CARD_LINK, CARD_LINK_PADDING, linkClasses, type LinkSize, type LinkTone } from './linkModel';
import { useLineClamped } from './useLineClamped';

type LinkProps = ComponentProps<typeof Link>;

// a title sets its own size (a bare link inherits the shell's, about 16px); a link INSIDE a sentence (linkClasses) keeps the sentence's
const SIZE: Record<LinkSize, string> = { body: 'text-ds-body', label: 'text-ds-label' };

export interface TitleLinkProps extends Omit<LinkProps, 'title' | 'children' | 'className'> {
  /** The words of the link: the record's name. Cut after `lines`; the whole of it is the tooltip only when it is cut, and always in the accessible name. */
  title: string;
  /** Lines before the cut, 1 to 6. */
  lines?: number;
  /** The colours: `title` (default), `text` (the brand colour) or `muted`. */
  tone?: LinkTone;
  /** The size of the line it sits in: `body` (13px, default) or `label` (12px). */
  size?: LinkSize;
  /** Layout only (margin, width): it goes on the div the link sits in, so a parent's `space-y-*` and your margin never fight the link's own. */
  className?: string;
}

export function TitleLink({ title, lines, tone, size, className, ...rest }: TitleLinkProps) {
  const [text, cut] = useLineClamped<HTMLSpanElement>();
  // The cut is on an inner span: `line-clamp` on the link itself would show its third line through the link's own padding (the phone's 44px target).
  // The link sits in a div of its own formatting context (`flow-root`): a parent's `space-y-*` would overwrite the link's negative margins (the ones that
  // cancel its padding) and two links stacked in a block would collapse theirs into one; here they stay inside the div, which is exactly as tall as the text.
  // So the target is 24px (44px on a phone) in every parent and nothing moves.
  return (
    <div className={clsx('flow-root min-w-0', className)}>
      <Link {...rest} title={cut ? title : undefined} className={clsx('block [overflow-wrap:anywhere]', SIZE[size ?? 'body'], tone === 'muted' && 'font-normal', linkClasses({ tone, size }))}>
        <span ref={text} className={CLAMP_CLASS[clampLines(lines ?? 2)]}>{title}</span>
      </Link>
    </div>
  );
}

export interface CardLinkProps extends Omit<LinkProps, 'className'> {
  /** Padding inside the card (16px). Turn it off for a card whose content brings its own edge-to-edge parts. */
  padded?: boolean;
  /** Layout only (margin, width, height). */
  className?: string;
}

export function CardLink({ padded = true, className, children, ...rest }: CardLinkProps) {
  return <Link {...rest} className={clsx(CARD_LINK, padded && CARD_LINK_PADDING, className)}>{children}</Link>;
}
