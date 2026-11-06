'use client';

// Governance > Mappings: link governance documents to controls, in two forms of one component:
//   standalone  /governance/mappings          the documents beside what the open one is mapped to (_Standalone.tsx; the open document is ?doc=<id>)
//   embedded    a document's Mappings view    locked to that document, no page head (_Embedded.tsx): the document page renders
//               <GovernanceMappingsPage initialDocumentId={id} canEdit={mayChange} /> (and the classic page, `initialDocumentId` alone)
// Both are built from the same pieces on the design-system kit (components/ui/ds); the rules (the framework groups, the mapped figure, the address) are
// mappingsModel.ts; the reads are _queries.ts. The requests, query keys, payloads and who may do what are as they were: this file only reads the rights.
import { usePermissions } from '@/hooks/usePermissions';
import { EmbeddedMappings } from './_Embedded';
import { StandaloneMappings } from './_Standalone';

export default function GovernanceMappingsPage({ initialDocumentId, canEdit }: { initialDocumentId?: number; canEdit?: boolean } = {}) {
  // `initialDocumentId` (passed when embedded in a document's Mappings tab) locks the view to that document: no document picker, no portfolio figures, just
  // its framework-clause mappings scoped to its own frameworks and its linked internal controls. `canEdit`: the person may change that document (its
  // editors, the owner among them: the server lets them run and link); when given it decides, without it the tab is read only. Not given: the rights decide.
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canCreate = canEdit ?? hasPermission('governance:mappings:create');
  const canDelete = canEdit ?? hasPermission('governance:mappings:delete');
  // the internal (ERM) controls are behind the ERM right: not asked for without it (a 403 for everyone else)
  const canErm = hasPermission('erm:risks:view');
  const rights = { canCreate, canDelete, canErm, permissionsLoading };

  return initialDocumentId != null
    ? <EmbeddedMappings documentId={initialDocumentId} {...rights} />
    : <StandaloneMappings {...rights} />;
}
