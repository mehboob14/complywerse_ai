'use client';

// The building blocks of the style guide page: a section with its anchor, a component card (use when, do not, specimens, props), a labelled
// specimen, a row of specimens, and the props table. The page follows the kit rules itself (guide.test.ts holds this folder to kitGuard's rules):
// tokens and arbitrary values only, an explicit size on every bare <p>, and `!` on the headings because the shell remaps a bare h1/h2.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { RowHeaderCell, Table, TBody, Td, Th, THead, Tr } from '@/components/ui';
import { DOCS, type ComponentDoc, type PartDoc } from './docs';

/** Monospace at the label size, for names, types and code. */
export const MONO = 'font-mono text-ds-label';

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Text with `code` spans: what sits between backticks is drawn in the monospace face. */
function Prose({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i} className={clsx(MONO, 'text-ds-fg')}>{part}</code> : part))}</>;
}

export function GuideSection({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} data-guide-section={id} aria-labelledby={`${id}-title`} className="scroll-mt-[8px] space-y-[16px] border-t border-ds-border pt-[24px]">
      <div>
        <h2 id={`${id}-title`} className="!text-ds-title !text-ds-fg">{title}</h2>
        {lead && <p className="mt-1 max-w-[760px] text-ds-body text-ds-fg-muted">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

/** A small heading inside a section that is not a component (the type scale, the status registries). */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="!text-ds-section !text-ds-fg">{children}</h3>;
}

const GAPS = { 8: 'gap-[8px]', 12: 'gap-[12px]', 16: 'gap-[16px]' } as const;
const ALIGNS = { start: 'items-start', center: 'items-center', end: 'items-end' } as const;

/** Wraps specimens that sit side by side and wrap on a narrow screen. */
export function Row({ children, gap = 8, align = 'center', className }: { children: ReactNode; gap?: keyof typeof GAPS; align?: keyof typeof ALIGNS; className?: string }) {
  return <div className={clsx('flex flex-wrap', GAPS[gap], ALIGNS[align], className)}>{children}</div>;
}

/** One live example, with its caption. */
export function Specimen({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0 space-y-[6px]', className)}>
      <p className="text-ds-label text-ds-fg-muted">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A grid of specimens: one column on a phone, two from 768 px, three from 1280 px. */
export function Grid({ children, cols = 3, className }: { children: ReactNode; cols?: 2 | 3; className?: string }) {
  return (
    <div className={clsx('grid grid-cols-1 gap-[16px] md:grid-cols-2', cols === 3 && 'xl:grid-cols-3', className)}>{children}</div>
  );
}

/** The props of one part as a table (Prop, Type, Default, What it does); a function or a hook says Call and Returns instead. */
export function PropsTable({ part, titled }: { part: PartDoc; titled: boolean }) {
  const fn = part.fn === true;
  return (
    <div className="min-w-0">
      {titled && <p className="mb-[4px] text-ds-label font-medium text-ds-fg">{part.name}</p>}
      <div className="max-w-full overflow-x-auto rounded-ds-card border border-ds-border">
        <Table caption={`${fn ? 'Calls' : 'Props'} of ${part.name}`} className="min-w-[760px] [table-layout:fixed]">
          <colgroup>
            <col className={fn ? 'w-[250px]' : 'w-[160px]'} />
            <col className="w-[230px]" />
            {!fn && <col className="w-[120px]" />}
            <col />
          </colgroup>
          <THead>
            <Tr>
              <Th>{fn ? 'Call' : 'Prop'}</Th>
              <Th>{fn ? 'Returns' : 'Type'}</Th>
              {!fn && <Th>Default</Th>}
              <Th>What it does</Th>
            </Tr>
          </THead>
          <TBody>
            {part.props.map((p) => (
              <Tr key={p.name}>
                <RowHeaderCell className="align-top"><code className={clsx(MONO, 'text-ds-fg')}>{p.name}</code></RowHeaderCell>
                <Td className="align-top"><code className={clsx(MONO, 'text-ds-fg-body')}>{p.type}</code></Td>
                {!fn && <Td className="align-top"><code className={clsx(MONO, 'text-ds-fg-muted')}>{p.default ?? '—'}</code></Td>}
                <Td className="align-top"><Prose text={p.note} /></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

/** A group of one-line functions (the formatters, the table logic) as ONE table: a call, what it returns, what it does. */
function CallsTable({ doc }: { doc: ComponentDoc }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-ds-card border border-ds-border">
      <Table caption={`Calls of ${doc.name}`} className="min-w-[760px] [table-layout:fixed]">
        <colgroup>
          <col className="w-[330px]" />
          <col className="w-[190px]" />
          <col />
        </colgroup>
        <THead><Tr><Th>Call</Th><Th>Returns</Th><Th>What it does</Th></Tr></THead>
        <TBody>
          {doc.parts.map((part) => {
            const p = part.props[0];
            return (
              <Tr key={part.name}>
                <RowHeaderCell className="align-top"><code className={clsx(MONO, 'text-ds-fg')}>{p.name.startsWith('(') ? `${part.name}${p.name}` : `${part.name} = ${p.name}`}</code></RowHeaderCell>
                <Td className="align-top"><code className={clsx(MONO, 'text-ds-fg-body')}>{p.type}</code></Td>
                <Td className="align-top"><Prose text={p.note} /></Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

/** The card of one component: where to import it, when to use it, what not to do, its live specimens, and its props. */
export function Spec({ name, children }: { name: string; children?: ReactNode }) {
  const doc = DOCS[name];
  if (!doc) throw new Error(`the guide has no documentation for ${name}`);
  const imports = doc.imports ?? [doc.parts[0].name];
  const id = `spec-${slug(name)}`;
  return (
    <article id={id} data-guide-component={name} aria-labelledby={`${id}-name`} className="min-w-0 scroll-mt-[8px] space-y-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[4px]">
        <h3 id={`${id}-name`} className="!text-ds-section !text-ds-fg">{name}</h3>
        <code className={clsx(MONO, 'min-w-0 break-all text-ds-fg-muted')}>{`import { ${imports.join(', ')} } from '${doc.importFrom}'`}</code>
      </div>
      <p className="text-ds-body text-ds-fg-body"><span className="font-medium text-ds-fg">Use when </span><Prose text={doc.use} /></p>
      {doc.dont && <p className="border-l-2 border-ds-danger-border pl-[12px] text-ds-body text-ds-fg-body"><Prose text={doc.dont} /></p>}
      {children && <div className="min-w-0 space-y-[16px] rounded-ds-card bg-ds-bg p-[16px]">{children}</div>}
      <div className="min-w-0 space-y-[12px]">
        {doc.parts.length > 1 && doc.parts.every((part) => part.fn && part.props.length === 1)
          ? <CallsTable doc={doc} />
          : doc.parts.map((part) => <PropsTable key={part.name} part={part} titled={doc.parts.length > 1 || part.name !== name} />)}
      </div>
    </article>
  );
}
