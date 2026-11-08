'use client';

// The Control Library (/control-library): the unified, de-duplicated controls across all the frameworks, drawn by _library/LibraryPage. ?fw=A,B keeps the framework view a link carries.
import { LibraryPage } from './_library/LibraryPage';

export const dynamic = 'force-dynamic';

export default function ControlLibraryPage() {
  return <LibraryPage />;
}
