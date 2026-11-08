// Importing a risk register, moved out of the list page with its three paths UNCHANGED in what they read and send:
//   1LINK            the server reads the workbook (POST /erm/onboarding/import-register) and keeps every column
//   NCA Template     the workbook is read here and each row is posted to /risks/nca, which also bridges it into the register (one request a row)
//   any other        POST /erm/risks/upload (the UBL-format reader)
// A failure throws an Error whose message a person can read; the rows that could not be posted are named ("Row 14"), not counted.
import * as XLSX from 'xlsx';
import apiClient, { ermApi } from '@/lib/api';

export const ONELINK = '1LINK';
export const isNca = (v: string | null | undefined): boolean => /^nca(template)?$/.test((v || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

export interface ImportOutcome { message: string; created: number; skipped: number; errors: string[] }

/** What a server refusal says in words: the server's own sentence when it sent one, else the plain fallback. */
function said(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}

export async function importRegister(file: File, registerType: string): Promise<ImportOutcome> {
  if (registerType === ONELINK) {
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await apiClient.post('/erm/onboarding/import-register', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      return {
        message: `1LINK register: imported ${data.created} risk${data.created === 1 ? '' : 's'}${data.skipped ? `, skipped ${data.skipped} already present` : ''}`,
        created: data.created ?? 0, skipped: data.skipped ?? 0, errors: data.errors ?? [],
      };
    } catch (err) {
      throw new Error(said(err, 'The 1LINK register could not be imported.'));
    }
  }

  if (isNca(registerType)) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        // Pick the data sheet (skip Cover Page / Legend / Heat map / etc.)
        let ws: XLSX.WorkSheet | null = null;
        const preferred = wb.SheetNames.find((n) => {
          const s = n.toLowerCase();
          return s.includes('risk register') && !s.includes('legend');
        });
        if (preferred) ws = wb.Sheets[preferred];
        if (!ws) {
          for (const name of wb.SheetNames) {
            const cand = wb.Sheets[name];
            const probe: any[][] = XLSX.utils.sheet_to_json(cand, { header: 1, defval: '' }) as any;
            for (let r = 0; r < Math.min(probe.length, 20); r++) {
              const rowStr = (probe[r] || []).map((c) => String(c || '').toLowerCase()).join(' ');
              if (rowStr.includes('risk identifier') && rowStr.includes('threat')) { ws = cand; break; }
            }
            if (ws) break;
          }
        }
        if (!ws) throw new Error('Could not find a Risk Register sheet in this workbook');

        // Find the header row (NCA puts it at row 11 / idx 10)
        const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any;
        let headerRowIdx = 0;
        for (let r = 0; r < Math.min(allRows.length, 25); r++) {
          const rowStr = (allRows[r] || []).map((c) => String(c || '').toLowerCase()).join(' ');
          if (rowStr.includes('risk identifier') || (rowStr.includes('risk owner') && rowStr.includes('threat'))) {
            headerRowIdx = r;
            break;
          }
        }
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRowIdx, raw: false });

        let created = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const keys = Object.keys(r);
          const ci = (name: string) => {
            const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();
            const key = keys.find((k) => k.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(norm));
            return key ? r[key] : undefined;
          };
          const toStr = (v: any) => (v === null || v === undefined || v === '') ? null : String(v).trim() || null;
          const toInt = (v: any) => { const n = parseInt(v); return isNaN(n) ? null : n; };
          const toDate = (v: any) => {
            if (!v) return null;
            if (v instanceof Date) return v.toISOString().split('T')[0];
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
          };
          const stripPlaceholder = (v: string | null): string | null => {
            if (!v) return null;
            if (/^please\s+select/i.test(v.trim())) return null;
            return v;
          };

          const payload = {
            risk_area:                stripPlaceholder(toStr(ci('risk area'))),
            risk_owner:               stripPlaceholder(toStr(ci('risk owner'))),
            date_identified:          toDate(ci('date of risk identification')),
            description:              toStr(ci('description of the risk') ?? ci('description')),
            risk_cause:               toStr(ci('risk cause')),
            threat:                   stripPlaceholder(toStr(ci('threat'))),
            risk_analysis:            toStr(ci('risk analysis and consequences') ?? ci('risk analysis')),
            date_analysis:            toDate(ci('date of risk analysis')),
            inherent_likelihood:      toInt(ci('inherent risk likelihood')),
            inherent_impact:          toInt(ci('inherent risk magnitude') ?? ci('inherent risk impact')),
            inherent_rating_override: stripPlaceholder(toStr(ci('updated overall inherent risk rating') ?? ci('updated inherent risk rating'))),
            treatment_type:           stripPlaceholder(toStr(ci('type of treatment action'))),
            treatment_description:    toStr(ci('risk treatment description')),
            treatment_owner:          stripPlaceholder(toStr(ci('owner of the treatment') ?? ci('owner of treatment') ?? ci('treatment owner'))),
            treatment_deadline:       toDate(ci('deadline for action')),
            residual_description:     toStr(ci('residual risk description')),
            residual_likelihood:      toInt(ci('residual risk likelihood')),
            residual_impact:          toInt(ci('residual risk magnitude') ?? ci('residual risk impact')),
            following_steps:          toStr(ci('following steps description') ?? ci('following steps')),
            last_evaluation_date:     toDate(ci('last evaluation date')),
            comment:                  toStr(ci('comment')),
          };

          const meaningful = [
            payload.description, payload.risk_owner, payload.threat,
            payload.risk_cause, payload.risk_analysis, payload.treatment_description,
            payload.risk_area,
          ];
          if (!meaningful.some((v) => v !== null && v !== '' && v !== undefined)) continue;

          try {
            await apiClient.post('/risks/nca', payload);
            created++;
          } catch {
            errors.push(`Row ${headerRowIdx + i + 2}`);
          }
        }
      return { message: `NCA template: imported ${created} risk${created === 1 ? '' : 's'}`, created, skipped: 0, errors };
    } catch (err) {
      throw new Error(err instanceof Error && err.message ? err.message : 'The NCA template could not be imported.');
    }
  }

  try {
    const response = await ermApi.risks.uploadRiskRegister(file, registerType || undefined);
    return response.data;
  } catch (err) {
    throw new Error(said(err, 'The file could not be imported.'));
  }
}

/** The xlsx template the standard path reads. */
export async function downloadTemplate(): Promise<void> {
  const response = await ermApi.risks.downloadTemplate();
  const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'risk_register_template.xlsx';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

/** Older NCA entries that pre-date the bridge column have no risk of their own and stay out of the register until they are bridged. It was done silently whenever the NCA filter was
 *  picked (a write on a filter); it is a button now, and says what it did. */
export async function bridgeOlderNcaEntries(): Promise<number> {
  const res = await apiClient.post('/risks/nca/backfill-bridges');
  return res.data?.newly_bridged ?? 0;
}
