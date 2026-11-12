'use client';

// The Directory's files: the library's own list (one lean request, cut to what the person may read, shared with the library through its cache key) read as files
// (directoryFiles.ts). A failed read is its own state, never an empty folder; a refusal (403: the person may read no documents) says so instead of an error.
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LIBRARY_LIST_KEY, readLibraryList } from '@/lib/directoryFilesApi';
import { canRetry, statusOf } from '@/components/ui/ds/reportOutcome';
import { filesFrom, type DirFile } from './directoryFiles';

export interface FilesData {
  files: readonly DirFile[];
  /** the answer says it does not hold every document */
  partial: boolean;
  /** not yet answered (the first read) */
  loading: boolean;
  /** the read failed and there is no list to show (a refusal is `refused`, not this) */
  failed: boolean;
  /** the person may read no documents: no files are shown, and that is not an error */
  refused: boolean;
  error: unknown;
  refetch: () => void;
}

const NONE: readonly DirFile[] = [];

export function useDirectoryFiles(): FilesData {
  const q = useQuery({ queryKey: LIBRARY_LIST_KEY, queryFn: readLibraryList, staleTime: 30_000, retry: (failures, e) => failures < 2 && canRetry(e) });
  const parsed = useMemo(() => (q.data === undefined ? null : filesFrom(q.data)), [q.data]);
  const refused = statusOf(q.error) === 403 && !parsed;
  const { refetch } = q;
  const again = useCallback(() => { void refetch(); }, [refetch]);
  return {
    files: parsed?.files ?? NONE,
    partial: parsed?.partial ?? false,
    loading: q.isPending,
    failed: q.isError && !parsed && !refused,
    refused,
    error: q.error,
    refetch: again,
  };
}
