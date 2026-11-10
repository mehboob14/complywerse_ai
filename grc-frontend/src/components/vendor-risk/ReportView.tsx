// Draws any third-party risk report (committee pack, register, vendor file, ratings, supplier summary): the headline figures, then each section as a table, or as paragraphs. Used inside the app (the kept
// report page, the Generate sheet's preview) and on the examiner's read-only page, so it depends on nothing but its props and the design-system tokens (no shell class, no hook). Rebuilt on the kit's
// tokens in vendor-insights-setup: nothing under 12px (it had seven text sizes at 11px), every cell carries its own size and colour (a bare <td> is 11.5px in the shell), dates read "12 Nov 2026".
// `heading` says how the report names itself: the examiner's page keeps the report's title as its h1 (the default), the app's pages name it in their own head ('none') or in a sheet ('h2').
import { formatDate } from '@/lib/format';

export interface ReportSection {
  key: string;
  title: string;
  note?: string | null;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  paragraphs?: string[];
}

export interface ReportContent {
  kind: string;
  title: string;
  as_of?: string;
  period?: { start: string; end: string };
  headline?: Array<{ label: string; value: string | number | null; hint?: string }>;
  sections: ReportSection[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A date as "12 Nov 2026"; a date-only value keeps its calendar day; nothing recorded is "—"; a value that is not a date is returned as it is. */
export function fmtDay(value?: string | null): string {
  if (!value) return '—';
  const shown = formatDate(value, { calendar: ISO_DAY.test(value) });
  return shown === '—' ? value : shown;
}

function cell(value: string | number | null) {
  if (value === null || value === undefined || value === '') return <span className="text-ds-fg-muted">—</span>;
  if (typeof value === 'string' && ISO_DAY.test(value)) return fmtDay(value);
  return String(value);
}

const TITLE = 'min-w-0 break-words !text-ds-title !font-[600] !text-ds-fg';
const SUB = 'min-w-0 break-words !text-ds-section !font-[600] !text-ds-fg';

export default function ReportView({ content, heading = 'h1' }: { content: ReportContent; heading?: 'h1' | 'h2' | 'none' }) {
  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        {heading === 'h1' && <h1 className={`m-0 ${TITLE}`}>{content.title}</h1>}
        {heading === 'h2' && <h2 className={`m-0 ${SUB}`}>{content.title}</h2>}
        <p className="text-ds-body text-ds-fg-muted">
          {content.period ? <>Period {fmtDay(content.period.start)} to {fmtDay(content.period.end)} · </> : null}
          Figures as at {fmtDay(content.as_of)}
        </p>
      </div>

      {(content.headline || []).length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-[8px] print:grid-cols-6">
          {content.headline!.map((h) => (
            <div key={h.label} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
              <p className="break-words text-ds-label text-ds-fg-muted">{h.label}</p>
              <p className="break-words text-[20px] font-[600] leading-[28px] text-ds-fg">{h.value ?? '—'}</p>
              {h.hint && <p className="break-words text-ds-label text-ds-fg-muted">{h.hint}</p>}
            </div>
          ))}
        </div>
      )}

      {content.sections.map((s) => (
        <section key={s.key} className="break-inside-avoid rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
          <h2 className={`m-0 ${SUB}`}>{s.title}</h2>
          {s.note && <p className="mt-[2px] text-ds-body text-ds-fg-muted">{s.note}</p>}
          {s.paragraphs?.length ? (
            <div className="mt-[8px] flex flex-col gap-[8px]">{s.paragraphs.map((p, i) => <p key={i} className="text-ds-body text-ds-fg-body">{p}</p>)}</div>
          ) : s.rows.length === 0 ? (
            <p className="mt-[8px] text-ds-body text-ds-fg-muted">None.</p>
          ) : (
            <div className="mt-[8px] overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-ds-border">
                    {s.columns.map((c) => <th key={c} scope="col" className="px-[8px] py-[6px] text-ds-label font-[600] text-ds-fg-muted">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ds-border">
                  {s.rows.map((r, i) => (
                    <tr key={i} className="align-top">
                      {r.map((v, j) => <td key={j} className="whitespace-pre-line break-words px-[8px] py-[6px] text-ds-body text-ds-fg">{cell(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
