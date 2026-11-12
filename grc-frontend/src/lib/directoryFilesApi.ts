// The Directory's files: the documents filed in a folder. There is no request of its own: the Directory reads the library's own lean list (`GET /governance/documents?lean=1`, up to
// 10,000 rows in one request, already cut to the documents the person may read) and narrows it to the open folder on the screen (app/(dashboard)/governance/documents/directory/
// directoryFiles.ts). The key is the library's own on purpose: the two pages share one cached list, so going from the Directory to the library (or back) asks nothing again, and
// anything that changes a document and refreshes the library's list refreshes this one too.
import apiClient from '@/lib/api';

/** The library's cache key for its list (`DocumentsWorkspace`): the same request, the same answer. */
export const LIBRARY_LIST_KEY = ['gov-docs-workspace'] as const;

/** The most rows one lean request holds (the library's own ceiling). */
export const LIBRARY_LIST_LIMIT = 10_000;

/** The answer as the library reads it (`{ items, total, lean, truncated }`, a bare array made into that shape): the cache holds one shape whichever page asked first. The Directory only reads `items` and `truncated`. */
export async function readLibraryList(): Promise<unknown> {
  const { data } = await apiClient.get<unknown>('/governance/documents', { params: { lean: 1, limit: LIBRARY_LIST_LIMIT, sort_by: 'updated_at', sort_order: 'desc' } });
  return Array.isArray(data) ? { items: data, total: data.length, skip: 0, limit: data.length } : data;
}
