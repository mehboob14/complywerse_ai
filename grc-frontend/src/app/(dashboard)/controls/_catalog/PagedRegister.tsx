'use client';

// A register of Catalog controls that asks the server for one page at a time and says the TRUE total under it ("1–50 of 1,243 controls"). A group of a domain, a framework and the internal
// controls hold their page here; the All controls view holds its page in the address and passes it in. A failed read is an error with Retry, never an empty table.
import { useState, type ReactNode } from 'react';
import { Pager } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useCatalogList } from './catalogData';
import { PAGE_SIZE, PAGE_SIZES, type CatalogRow } from './catalogModel';
import { ControlRegister } from './ControlRegister';

const NOUN = { one: 'control', other: 'controls' };

export interface PagedRegisterProps {
  caption: string;
  /** names what the list is, so two lists never share an answer */
  scopeKey: readonly unknown[];
  /** the query string for a page: (page, pageSize) => 'skip=0&limit=50&…' */
  buildQuery: (page: number, pageSize: number) => string;
  showDomain?: boolean;
  empty?: ReactNode;
  onOpen: (row: CatalogRow) => void;
  /** the page, when the address holds it */
  page?: number;
  onPage?: (page: number) => void;
}

export function PagedRegister({ caption, scopeKey, buildQuery, showDomain, empty, onOpen, page: pageProp, onPage }: PagedRegisterProps) {
  const [own, setOwn] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const page = pageProp ?? own;
  const setPage = onPage ?? setOwn;
  const q = useCatalogList([...scopeKey, pageSize], buildQuery(page, pageSize));
  const list = q.data;
  const failed = q.isError && !list;
  return (
    <ControlRegister
      caption={caption}
      rows={list?.items ?? []}
      showDomain={showDomain}
      loading={q.isPending}
      error={failed ? { message: `The controls could not be loaded. ${errorMessage(q.error)}`, onRetry: canRetry(q.error) ? () => { void q.refetch(); } : undefined } : null}
      empty={empty}
      footer={list && list.total > 0 ? (
        <Pager page={page} pageSize={pageSize} total={list.total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} pageSizes={PAGE_SIZES} noun={NOUN} />
      ) : undefined}
      onOpen={onOpen}
    />
  );
}
