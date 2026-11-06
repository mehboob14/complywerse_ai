'use client';

// The document picker of the exception form: any kind of controlled document can be the subject of an exception (policy, standard, procedure, guideline,
// charter, framework), so the picker has a Type filter and every result says its kind. With nothing typed it lists the documents of the kind chosen from the
// page's own list (by title); once words are typed it asks the server (GET /policy-exceptions/search-policies: the titles, descriptions and wording of every
// document the person may read, 20 at a time) after a short pause, and each document is listed once. A chosen document shows as one line with Change and
// remove; a locked form (the exception waits under an approval rule) shows it without them. A document the person may not open is named without its number.
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { Button, ErrorState, IconButton, Select, SkeletonLines, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { DOC_TYPES, HIDDEN_DOCUMENT, PICKER_LIMIT, browseDocuments, uniqueDocuments, type DocRef, type DocumentOption } from './_logic';
import { TypeChip } from './_chips';

/** What search-policies answers for a document (a document found in its clauses too is answered once for each). */
interface Hit { document_id: number; document_title: string; doc_type: string; document_code?: string | null; match_field?: string; snippet?: string | null }

interface Row { id: number; title: string; type: string; code: string; snippet: string; unit?: number | null }

/** `value` after it has stayed the same for `ms`: a search asks the server once the person pauses, not at every key. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

export function DocumentPicker({ chosen, documents, onPick, onClear, disabled = false }: {
  /** what is chosen (the form works out its title, kind and unit from what it has) */
  chosen: DocRef | null;
  /** the page's list of documents: it is what is listed while nothing is typed */
  documents: { data?: DocumentOption[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  onPick: (doc: DocRef) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const typed = query.trim();
  const term = useDebounced(typed, 300);

  const search = useQuery({
    queryKey: ['exception-document-search', term, type],
    queryFn: async () => uniqueDocuments(((await policyExceptionApi.searchPolicies(term, PICKER_LIMIT, type || undefined)).data?.results ?? []) as Hit[]),
    enabled: term !== '',
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: (n, e) => n < 1 && canRetry(e),
  });

  const searching = typed !== '';
  const waiting = searching && (typed !== term || search.isFetching);
  const rows: Row[] = searching
    ? (search.data ?? []).map((h) => ({
      id: h.document_id, title: h.document_title, type: h.doc_type, code: (h.document_code ?? '').trim(),
      snippet: h.match_field && h.match_field !== 'title' ? (h.snippet ?? '').trim() : '',
      unit: (documents.data ?? []).find((d) => d.id === h.document_id)?.department_id,
    }))
    : browseDocuments(documents.data ?? [], type).map((d) => ({ id: d.id, title: d.title, type: d.doc_type ?? '', code: (d.document_code ?? '').trim(), snippet: '', unit: d.department_id }));

  const pick = (row: Row) => {
    onPick({ id: row.id, title: row.title, type: row.type, code: row.code, unit: row.unit });
    setChanging(false);
    setQuery('');
  };

  if (chosen && !changing) {
    return (
      <div className="flex min-h-ds-control flex-wrap items-center gap-x-[8px] gap-y-[4px] rounded-ds-control border border-ds-border-strong bg-ds-surface px-[12px] py-[4px]">
        <span className={`min-w-0 flex-1 break-words text-ds-body ${chosen.title === null ? 'text-ds-fg-muted' : 'text-ds-fg'}`}>{chosen.title ?? HIDDEN_DOCUMENT}</span>
        <TypeChip type={chosen.type} />
        {chosen.code && <span className="text-ds-label text-ds-fg-muted">{chosen.code}</span>}
        {!disabled && (
          <span className="flex items-center gap-[4px]">
            <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>Change</Button>
            <IconButton label="Remove the document" onClick={onClear}><X aria-hidden /></IconButton>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-col gap-[8px] sm:flex-row">
        <TextInput
          className="min-w-0 flex-1"
          aria-label="Search documents"
          placeholder="Search by title, code or wording"
          autoComplete="off"
          spellCheck={false}
          autoFocus={changing}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select aria-label="Document type" placeholder="All types" value={type} onChange={(e) => setType(e.target.value)} className="sm:w-[168px]">
          {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        {chosen && <Button onClick={() => { setChanging(false); setQuery(''); }}>Cancel</Button>}
      </div>

      <div aria-busy={waiting || undefined} className="max-h-[260px] overflow-y-auto rounded-ds-control border border-ds-border bg-ds-surface">
        {searching && search.isError && !search.data ? (
          <ErrorState compact title="Couldn't search the documents" message={errorMessage(search.error)} onRetry={canRetry(search.error) ? () => { void search.refetch(); } : undefined} />
        ) : !searching && documents.isError && !documents.data ? (
          <ErrorState compact title="Couldn't load the documents" message={errorMessage(documents.error)} onRetry={() => { void documents.refetch(); }} />
        ) : (searching ? !search.data : documents.isLoading) ? (
          <div className="p-[12px]"><SkeletonLines lines={3} label="Loading the documents" /></div>
        ) : rows.length === 0 ? (
          <span className="block px-[12px] py-[16px] text-center text-ds-body text-ds-fg-muted">{searching ? 'No documents found' : 'No documents'}</span>
        ) : (
          <ul role="list" aria-label="Documents">
            {rows.map((row) => (
              <li key={row.id} className="border-b border-ds-border last:border-b-0">
                <button type="button" onClick={() => pick(row)} className={`flex min-h-[44px] w-full flex-col gap-[2px] px-[12px] py-[6px] text-left hover:bg-ds-surface-hover ${FOCUS}`}>
                  <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                    <span className="min-w-0 break-words text-ds-body font-medium text-ds-fg">{row.title}</span>
                    <TypeChip type={row.type} />
                    {row.code && <span className="text-ds-label text-ds-fg-muted">{row.code}</span>}
                  </span>
                  {row.snippet && <span className="line-clamp-2 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{row.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span role="status" className="sr-only">{searching && !waiting ? `${rows.length} ${rows.length === 1 ? 'document' : 'documents'} found` : ''}</span>
    </div>
  );
}
