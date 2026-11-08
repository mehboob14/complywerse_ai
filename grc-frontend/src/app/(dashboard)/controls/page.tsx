'use client';

// The Control Catalog (/controls): the compliance workbench for the controls an organisation works, drawn by _catalog/CatalogPage. Every address that opened the old page keeps working:
// /controls?mode=internal, /controls?promote=1 and /controls?framework=<id>.
import { CatalogPage } from './_catalog/CatalogPage';

export const dynamic = 'force-dynamic';

export default function ControlCatalogPage() {
  return <CatalogPage />;
}
