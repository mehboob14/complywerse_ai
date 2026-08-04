'use client';

import { useRef, useState, type ReactNode } from 'react';
import { AlertCircle, File, FileSpreadsheet, FileText, Upload } from 'lucide-react';

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  complied: 'Complied',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const TYPE_LABEL: Record<string, string> = {
  requirement: 'Requirement',
  observation: 'Observation',
  finding: 'Finding',
  recommendation: 'Recommendation',
};

export const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));
export const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));
export const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));

export function StatusBadge({ status }: { status?: string }) {
  const s = (status || 'open').toLowerCase();
  const tones: Record<string, string> = {
    open: 'bg-slate-100 text-slate-700',
    in_progress: 'bg-sky-50 text-sky-700',
    complied: 'bg-emerald-50 text-emerald-700',
    closed: 'bg-slate-50 text-slate-500',
    cancelled: 'bg-rose-50 text-rose-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[s] || tones.open}`}>
      {STATUS_LABEL[s] || status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority?: string }) {
  const p = (priority || 'medium').toLowerCase();
  const tones: Record<string, string> = {
    critical: 'bg-rose-50 text-rose-700',
    high: 'bg-orange-50 text-orange-700',
    medium: 'bg-amber-50 text-amber-700',
    low: 'bg-slate-50 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[p] || tones.medium}`}>
      {PRIORITY_LABEL[p] || priority}
    </span>
  );
}

export function fmtDate(v?: string | null) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return v;
  }
}

/** Form field — matches Governance Documents create/edit panels. */
export const fieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

export const labelClass = 'mb-1 block text-sm font-medium text-slate-800';

export const helperClass = 'mt-1 text-xs text-slate-500';

export const btnSecondary =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50';

export const btnPrimary =
  'cw-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';

export const btnPrimaryLg =
  'cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50';

export const btnSecondaryLg =
  'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50';

export function formatApiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { detail?: unknown } }; message?: string };
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    return (
      detail
        .map((d) => (typeof d === 'string' ? d : (d as { msg?: string })?.msg || JSON.stringify(d)))
        .filter(Boolean)
        .join('; ') || fallback
    );
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return err?.message || fallback;
}

export function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-[11px] font-semibold text-white">
        {n}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>
    </div>
  );
}

/** Free-text category with suggestions from existing values (Documents-style field). */
export function CategoryField({
  value,
  onChange,
  suggestions = [],
  id = 'obs-category',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions?: string[];
  id?: string;
  disabled?: boolean;
}) {
  const listId = `${id}-suggestions`;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Category <span className="text-xs font-normal text-slate-400">(optional)</span>
      </label>
      <input
        id={id}
        list={listId}
        className={fieldClass}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. IFPD Circular, Inspection, Licensing"
        autoComplete="off"
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <p className={helperClass}>
        Group related observations (e.g. by circular, inspection, or theme).
      </p>
    </div>
  );
}

/** File types for AI Import (must stay in sync with backend upload-parse). */
export const AI_IMPORT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md,.rtf,.json,.log';

export const AI_IMPORT_EXT_SET = new Set(
  AI_IMPORT_ACCEPT.split(',').map((s) => s.replace('.', '').toLowerCase()),
);

/** Evidence / attachment — any common office & media type. */
export const EVIDENCE_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md,.rtf,.json,.log,.png,.jpg,.jpeg,.gif,.webp,.zip';

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExt(name: string | null | undefined): string {
  if (!name || !name.includes('.')) return '';
  return name.split('.').pop()!.toLowerCase();
}

export function getFileIcon(ext: string | null | undefined) {
  const type = (ext || '').toLowerCase();
  if (type === 'pdf') return FileText;
  if (['doc', 'docx', 'rtf', 'txt', 'md'].includes(type)) return FileText;
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(type)) return FileSpreadsheet;
  return File;
}

export function getFileTypeColor(ext: string | null | undefined): string {
  const type = (ext || '').toLowerCase();
  if (type === 'pdf') return 'text-rose-600';
  if (['doc', 'docx', 'rtf'].includes(type)) return 'text-sky-700';
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(type)) return 'text-emerald-600';
  return 'text-slate-400';
}

export function validateAiImportFile(file: File): string | null {
  const ext = fileExt(file.name);
  if (!ext || !AI_IMPORT_EXT_SET.has(ext)) {
    return 'Unsupported file type. Use PDF, Word, Excel, CSV, or plain text.';
  }
  if (file.size > 25 * 1024 * 1024) {
    return 'File is too large (max 25 MB).';
  }
  return null;
}

/** Documents-style drag-and-drop file zone for slide panels. */
export function FileDropzone({
  file,
  onFile,
  accept,
  hint,
  disabled,
  error,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  accept: string;
  hint: ReactNode;
  disabled?: boolean;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const ext = file ? fileExt(file.name) : null;
  const FileIcon = file ? getFileIcon(ext) : Upload;

  const take = (f: File | null) => {
    if (!f) {
      onFile(null);
      return;
    }
    onFile(f);
  };

  return (
    <div className="space-y-2">
      <div
        className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          disabled ? 'pointer-events-none opacity-60' : ''
        } ${
          dragActive
            ? 'border-primary-500 bg-primary-50'
            : file
              ? 'border-emerald-400 bg-emerald-50/40'
              : error
                ? 'border-rose-400 bg-rose-50/40'
                : 'border-slate-200 bg-slate-50 hover:border-primary-300'
        }`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
          take(e.dataTransfer.files?.[0] || null);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files?.[0] || null);
            e.target.value = '';
          }}
        />
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <FileIcon className={`h-12 w-12 ${getFileTypeColor(ext)}`} strokeWidth={1.5} />
            <p className="text-sm font-medium text-slate-900">{file.name}</p>
            <p className="text-xs text-slate-500">
              {ext ? ext.toUpperCase() : 'FILE'} · {formatFileSize(file.size)}
            </p>
            <button
              type="button"
              onClick={() => take(null)}
              className="mt-1 text-sm text-rose-600 hover:text-rose-700"
              disabled={disabled}
            >
              Remove file
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-12 w-12 text-slate-400" strokeWidth={1.5} />
            <p className="text-sm font-medium text-slate-800">Drag and drop your file here</p>
            <p className="text-sm text-slate-500">or</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={btnPrimary}
              disabled={disabled}
            >
              Browse files
            </button>
            <p className="mt-2 max-w-md text-xs text-slate-500">{hint}</p>
          </div>
        )}
      </div>
      {error && (
        <div className="flex items-start gap-2 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
