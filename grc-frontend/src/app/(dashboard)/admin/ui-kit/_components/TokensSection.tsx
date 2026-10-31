'use client';

// Tokens: every --ds colour with its live value and the ratio it is held to, every pair of the contrast list, the type scale, shape, sizes,
// shadow, focus ring and the 4px grid. The values are read from the page's own CSS, so the guide cannot show a colour the app does not use.
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { RowHeaderCell, StatusPill, Table, TBody, Td, Th, THead, Tr } from '@/components/ui';
import { ALL_SHOWN, SWATCH_GROUPS, formatRatio, needs, pairRows, partnerOf, type PairRow } from './tokens';
import { GuideSection, MONO, Row, Specimen, SubHeading } from './Guide';

const TOUCH = '(max-width: 767px), (pointer: coarse)';

/** token name -> its value now. Read after mount; read again when the window crosses into or out of the touch sizes. */
function useTokenValues(): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      ALL_SHOWN.forEach((t) => { next[t] = style.getPropertyValue(`--${t}`).trim(); });
      setValues(next);
    };
    read();
    const touch = window.matchMedia(TOUCH);
    touch.addEventListener('change', read);
    return () => touch.removeEventListener('change', read);
  }, []);
  return values;
}

function Verdict({ pass }: { pass: boolean | null }) {
  return pass === null ? <StatusPill tone="neutral" label="No ratio" size="sm" /> : <StatusPill tone={pass ? 'success' : 'danger'} label={pass ? 'Pass' : 'Fail'} size="sm" />;
}

function SwatchCard({ token, use, value, rows }: { token: string; use: string; value: string; rows: PairRow[] }) {
  const partner = partnerOf(token);
  const row = partner ? rows.find((r) => r.fg === partner.fg && r.bg === partner.bg) : undefined;
  const other = partner ? (partner.fg === token ? partner.bg : partner.fg) : '';
  return (
    <li className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <div aria-hidden className="h-[40px] rounded-ds-control border border-ds-border" style={{ background: `var(--${token})` }} />
      <p className="mt-2 break-all text-ds-body font-medium text-ds-fg">{`--${token}`}</p>
      <p className={clsx(MONO, 'text-ds-fg-muted')}>{value || '—'}</p>
      <p className="mt-1 text-ds-label text-ds-fg-muted">{use}</p>
      <div className="mt-2 flex flex-wrap items-center gap-[6px] text-ds-label text-ds-fg-muted">
        {partner && row ? (
          <>
            <span>{partner.fg === token ? 'On' : 'With'} <code className={MONO}>{other}</code></span>
            <span className="tabular-nums">{formatRatio(row.ratio)}</span>
            <Verdict pass={row.pass} />
          </>
        ) : (
          <span>Decorative: no words sit on it</span>
        )}
      </div>
    </li>
  );
}

function PairSample({ row }: { row: PairRow }) {
  return (
    <span aria-hidden className="inline-flex h-[28px] min-w-[56px] items-center justify-center rounded-ds-control border border-ds-border px-2 text-ds-body" style={{ background: `var(--${row.bg})`, color: `var(--${row.fg})` }}>
      {row.kind === 'words' ? 'Aa' : <span className="block h-[12px] w-[32px] rounded-[2px]" style={{ background: `var(--${row.fg})` }} />}
    </span>
  );
}

function PairsTable({ rows }: { rows: PairRow[] }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-ds-card border border-ds-border">
      <Table caption="Colour pairs and their contrast ratios">
        <THead>
          <Tr>
            <Th>Sample</Th>
            <Th>Words or mark</Th>
            <Th>On</Th>
            <Th align="right">Ratio</Th>
            <Th align="right">Needs</Th>
            <Th>Result</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={`${r.fg}/${r.bg}`}>
              <Td><PairSample row={r} /></Td>
              <RowHeaderCell className="whitespace-nowrap"><code className={MONO}>{r.fg}</code></RowHeaderCell>
              <Td className="whitespace-nowrap"><code className={MONO}>{r.bg}</code></Td>
              <Td align="right" className="tabular-nums">{formatRatio(r.ratio)}</Td>
              <Td align="right" className="whitespace-nowrap tabular-nums">{needs(r.min)} {r.kind === 'words' ? 'words' : 'control'}</Td>
              <Td><Verdict pass={r.pass} /></Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

const TYPE_SCALE = [
  { name: 'title', cls: 'text-ds-title', sample: 'Documents', use: 'The page title (one per page, 600)' },
  { name: 'section', cls: 'text-ds-section', sample: 'Review cycle', use: 'A card or a state title (600)' },
  { name: 'body', cls: 'text-ds-body', sample: 'Information security policy, approved 12 Nov 2026', use: 'Text, cells, inputs, buttons (400)' },
  { name: 'label', cls: 'text-ds-label', sample: 'Owner · Updated · Help text', use: 'Labels, help, pills, table headers (500): the floor, nothing is smaller' },
];

const GRID = [4, 8, 12, 16, 20, 24, 32, 40, 48];

export function TokensSection() {
  const values = useTokenValues();
  const rows = pairRows(values);
  return (
    <GuideSection id="tokens" title="Tokens" lead="The --ds variables in styles/tokens.css, read live from this page. Words must reach 4.5:1 against what they sit on, control outlines and the focus ring 3:1; a failing pair would show here in red.">
      {SWATCH_GROUPS.map((group) => (
        <div key={group.title} className="space-y-[8px]">
          <SubHeading>{group.title}</SubHeading>
          <ul className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.swatches.map((s) => <SwatchCard key={s.token} token={s.token} use={s.use} value={values[s.token] ?? ''} rows={rows} />)}
          </ul>
        </div>
      ))}

      <div className="space-y-[8px]" data-guide-component="Contrast pairs">
        <SubHeading>Every pair, with its ratio</SubHeading>
        <PairsTable rows={rows} />
      </div>

      <div className="space-y-[8px]">
        <SubHeading>Type scale</SubHeading>
        <div className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
          {TYPE_SCALE.map((t) => (
            <div key={t.name} className="flex flex-wrap items-baseline gap-x-[16px] gap-y-[4px] px-[16px] py-[12px]">
              <code className={clsx(MONO, 'w-[210px] max-w-full shrink-0 text-ds-fg-muted')}>{`${t.cls}  ${values[`ds-text-${t.name}`] ?? ''} / ${values[`ds-leading-${t.name}`] ?? ''}`}</code>
              <p className={clsx(t.cls, 'min-w-0 flex-1 basis-[12rem] break-words text-ds-fg')}>{t.sample}</p>
              <p className="text-ds-label text-ds-fg-muted">{t.use}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[24px] lg:grid-cols-2">
        <div className="space-y-[8px]" data-guide-component="Shape and size">
          <SubHeading>Shape and control height</SubHeading>
          <Row align="end" gap={16}>
            <Specimen label={`rounded-ds-control ${values['ds-radius-control'] ?? ''}`}><div className="h-[48px] w-[88px] rounded-ds-control border border-ds-border-strong bg-ds-surface" /></Specimen>
            <Specimen label={`rounded-ds-card ${values['ds-radius-card'] ?? ''}`}><div className="h-[48px] w-[88px] rounded-ds-card border border-ds-border-strong bg-ds-surface" /></Specimen>
          </Row>
          <Row align="end" gap={16}>
            <Specimen label="32 px: control (desktop)"><div className="flex h-[32px] w-[88px] items-center justify-center rounded-ds-control border border-ds-border-strong bg-ds-surface text-ds-body text-ds-fg-body">32</div></Specimen>
            <Specimen label="28 px: small (desktop)"><div className="flex h-[28px] w-[88px] items-center justify-center rounded-ds-control border border-ds-border-strong bg-ds-surface text-ds-label text-ds-fg-body">28</div></Specimen>
            <Specimen label="44 px: touch, both"><div className="flex h-[44px] w-[88px] items-center justify-center rounded-ds-control border border-ds-border-strong bg-ds-surface text-ds-body text-ds-fg-body">44</div></Specimen>
          </Row>
          <p className="text-ds-label text-ds-fg-muted">
            This window: <code className={MONO}>h-ds-control</code> is {values['ds-control-h'] ?? '…'}, <code className={MONO}>h-ds-control-sm</code> is {values['ds-control-h-sm'] ?? '…'}. A phone-width window or a coarse pointer makes both 44 px.
          </p>
        </div>

        <div className="space-y-[8px]" data-guide-component="Shadow and focus ring">
          <SubHeading>Shadow and focus ring</SubHeading>
          <Row align="end" gap={16}>
            <Specimen label="shadow-ds-pop: menus, popovers, dialogs"><div className="h-[48px] w-[120px] rounded-ds-card border border-ds-border bg-ds-surface shadow-ds-pop" /></Specimen>
            <Specimen label="shadow-ds-ring: focus-visible"><div className="flex h-[32px] w-[120px] items-center justify-center rounded-ds-control bg-ds-surface text-ds-body text-ds-fg-body shadow-ds-ring">Focused</div></Specimen>
            <Specimen label="inset ring: tabs, menu items, rows"><div className="flex h-[32px] w-[120px] items-center justify-center bg-ds-surface text-ds-body text-ds-fg-body shadow-[inset_0_0_0_2px_var(--ds-focus)]">Focused</div></Specimen>
          </Row>
          <p className="text-ds-label text-ds-fg-muted">Every interactive part shows one of these on keyboard focus; the ring is white then teal so it reads on any surface.</p>
        </div>
      </div>

      <div className="space-y-[8px]" data-guide-component="4px grid">
        <SubHeading>The 4 px grid</SubHeading>
        <Row align="end" gap={12}>
          {GRID.map((n) => (
            <Specimen key={n} label={`${n}`}><div className="rounded-[2px] border border-ds-primary bg-ds-primary-soft" style={{ width: n, height: n }} /></Specimen>
          ))}
        </Row>
        <p className="text-ds-label text-ds-fg-muted">Space is a multiple of 4 px: 4, 8, 12, 16, 24. Write the value (<code className={MONO}>px-[16px]</code>, <code className={MONO}>gap-[12px]</code>), not a named spacing class, because the shell rewrites the named ones.</p>
      </div>
    </GuideSection>
  );
}
