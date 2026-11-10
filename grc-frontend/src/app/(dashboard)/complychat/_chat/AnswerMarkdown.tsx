'use client';

// An answer drawn as the platform draws text: Markdown with every element given its size and colour (a bare <p>, <td> or <li> gets the shell's 11.5px and dark
// text), tables that scroll sideways inside their own frame instead of widening the page, nothing that shows only on hover, links to the platform's own pages
// through next/link and everything else in a new tab. The kit's tokens only (kit rules); 12px is the floor.
import { memo, type ReactNode } from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TEXT = 'text-ds-body text-ds-fg-body';
const LINK = 'font-medium text-ds-primary-text underline underline-offset-2 hover:text-ds-primary-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mb-[8px] mt-[16px] border-b border-ds-border pb-[4px] !text-ds-section !text-ds-fg first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-[6px] mt-[14px] !text-ds-section !text-ds-fg first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-[4px] mt-[12px] !text-ds-body !font-[600] !text-ds-fg first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-[4px] mt-[10px] !text-ds-body !font-[600] !text-ds-fg first:mt-0">{children}</h5>,
  p: ({ children }) => <p className={`mb-[8px] leading-[20px] last:mb-0 ${TEXT} [overflow-wrap:anywhere]`}>{children}</p>,
  ul: ({ children }) => <ul className={`mb-[8px] list-disc pl-[20px] last:mb-0 ${TEXT}`}>{children}</ul>,
  ol: ({ children }) => <ol className={`mb-[8px] list-decimal pl-[20px] last:mb-0 ${TEXT}`}>{children}</ol>,
  li: ({ children }) => <li className={`mb-[2px] leading-[20px] ${TEXT} [overflow-wrap:anywhere]`}>{children}</li>,
  strong: ({ children }) => <strong className="font-[600] text-ds-fg">{children}</strong>,
  em: ({ children }) => <em className="text-ds-fg-muted">{children}</em>,
  hr: () => <hr className="my-[12px] border-ds-border" />,
  blockquote: ({ children }) => <blockquote className={`my-[8px] border-l-[3px] border-ds-border-strong bg-ds-surface-subtle py-[6px] pl-[12px] ${TEXT}`}>{children}</blockquote>,
  pre: ({ children }) => <pre className="my-[8px] max-w-full overflow-x-auto rounded-ds-control bg-ds-surface-subtle p-[10px] text-ds-label text-ds-fg" tabIndex={0}>{children}</pre>,
  code: ({ children }) => <code className="rounded-ds-control bg-ds-surface-subtle px-[4px] py-[1px] font-mono text-ds-label text-ds-fg [overflow-wrap:anywhere]">{children}</code>,
  a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
  // A table is as wide as its columns need, in a frame that scrolls (and is reachable by keyboard: a scrolling region must take focus).
  table: ({ children }) => (
    <div tabIndex={0} className="my-[10px] max-w-full overflow-x-auto rounded-ds-control border border-ds-border focus-visible:outline-none focus-visible:shadow-ds-ring">
      <table className="min-w-full border-collapse text-left">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-ds-border last:border-b-0">{children}</tr>,
  // the kit's Th and Td write their size, colour and fill with `!` (the shell's rules for table cells win over a plain class): so do these
  th: ({ children }) => <th scope="col" className="whitespace-nowrap border-b !border-ds-border !bg-ds-surface-subtle px-[10px] text-left align-middle !text-ds-label !text-ds-fg-muted [&&]:!py-[8px]">{children}</th>,
  td: ({ children }) => <td className="min-w-[96px] max-w-[320px] px-[10px] align-top !text-ds-body !text-ds-fg-body [overflow-wrap:anywhere] [&&]:!py-[8px]">{children}</td>,
};

function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <>{children}</>;
  if (href.startsWith('/') && !href.startsWith('//')) return <Link href={href} className={LINK}>{children}</Link>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>{children}</a>;
}

/** The text of an answer. Memoised: a long chat does not parse every answer again when one more arrives. */
export const AnswerMarkdown = memo(function AnswerMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</ReactMarkdown>;
});
