import { redirect } from 'next/navigation';
import { directoryQuery } from '../_workspace/folders/foldersAddress';

export const dynamic = 'force-dynamic';

// Governance > Documents > Directory went into the library's Folders layout (2026-11-12): the same folders, now with the documents, in one place. This address stays for ever and forwards there,
// because bookmarks, e-mails and the links of other pages carry it: `?unit=<id>` is the Department filter (the folder you were in), `?open=<id>|org&tab=<tab>` is the Properties popup
// (`?props=...&tab=...`; foldersAddress.ts, tested). A server redirect, so no flash of an empty page.
export default function DirectoryForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  redirect(`/governance/documents${directoryQuery(searchParams)}`);
}
