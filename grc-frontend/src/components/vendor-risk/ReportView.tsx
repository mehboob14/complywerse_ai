// Draws any third-party risk report (committee pack, register, vendor file): the
// headline figures, then each section as a table. Used inside the app and on the
// examiner's read-only page, so it depends on nothing but its props.

export interface ReportSection {
  key: string;
  title: string;
  note?: string | null;
  columns: string[];
  rows: Array<Array<string | number | null>>;
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

export function fmtDay(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(ISO_DAY.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function cell(value: string | number | null) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-400">—</span>;
  if (typeof value === 'string' && ISO_DAY.test(value)) return fmtDay(value);
  return String(value);
}

export default function ReportView({ content }: { content: ReportContent }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{content.title}</h1>
        <p className="text-xs text-gray-500">
          {content.period ? <>Period {fmtDay(content.period.start)} to {fmtDay(content.period.end)} · </> : null}
          Figures as at {fmtDay(content.as_of)}
        </p>
      </div>

      {(content.headline || []).length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
          {content.headline!.map((h) => (
            <div key={h.label} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-[11px] text-gray-500">{h.label}</p>
              <p className="text-lg font-semibold text-slate-900">{h.value ?? '—'}</p>
              {h.hint && <p className="text-[11px] text-gray-500">{h.hint}</p>}
            </div>
          ))}
        </div>
      )}

      {content.sections.map((s) => (
        <section key={s.key} className="break-inside-avoid rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">{s.title}</h2>
          {s.note && <p className="mt-0.5 text-xs text-gray-500">{s.note}</p>}
          {s.rows.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">None.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    {s.columns.map((c) => <th key={c} scope="col" className="px-2 py-1.5 font-medium">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {s.rows.map((r, i) => (
                    <tr key={i} className="align-top text-slate-800">
                      {r.map((v, j) => <td key={j} className="whitespace-pre-line px-2 py-1.5">{cell(v)}</td>)}
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
