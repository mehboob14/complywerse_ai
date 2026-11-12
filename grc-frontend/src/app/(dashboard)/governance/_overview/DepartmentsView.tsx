'use client';

// The Departments view: the documents of one scope by department, from the top down, in the columns the person chose (status, type, the people waiting, reviews or issues):
// the table (docs/_DepartmentTable.tsx, the one table of departments on the page; the Summary has the graphic of the biggest five) and, under it, the frameworks: where the
// attention sits (the graphic) beside the table of every framework, weakest first. The departments are the scope's (the document figures); the frameworks are the whole
// organisation's and say so when a department is picked. Each part loads, fails and has nothing on its own; a failed request is never drawn as a 0.
import { ChartGrid, Cell } from '@/components/overview/charts';
import { Button, EmptyState, ErrorState, SectionCard, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { FileText } from 'lucide-react';
import { MatrixCard } from './docs/_DepartmentTable';
import type { MeasureId } from './docs/_matrix';
import { LIBRARY, isEmpty, type Overview } from './docs/_model';
import { AttentionHeatCard } from './GroupCharts';
import { GroupRows } from './Groups';
import { Denied, link, refused, type Feed } from './parts';
import type { PostureQuery } from './postureApi';
import { groupsMeta } from './postureModel';
import { wholeOrganisation } from './visualsModel';

function Frameworks({ posture, scoped }: { posture: PostureQuery; scoped: boolean }) {
  const first = posture.data?.pages[0];
  const said = wholeOrganisation(scoped, 'Documents are counted under each framework they are mapped to. Weakest first: the frameworks with the lowest share of reviews on time.');
  return (
    <ChartGrid>
      <Cell span={5}><AttentionHeatCard query={posture} scoped={scoped} /></Cell>
      <Cell span={7}>
        <SectionCard
          id="frameworks"
          title="By framework"
          meta={[first ? groupsMeta(first) : '', said.meta].filter(Boolean).join(' · ') || undefined}
          info={first ? [said.info, first.notes.counting, first.notes.review_health].join(' ') : said.info}
        >
          <GroupRows query={posture} by="framework" />
        </SectionCard>
      </Cell>
    </ChartGrid>
  );
}

export function DepartmentsView({ doc, measure, onMeasure, posture, scoped }: { doc: Feed<Overview>; measure: MeasureId; onMeasure: (next: MeasureId) => void; posture: PostureQuery; scoped: boolean }) {
  let body;
  if (doc.load === 'loading') {
    body = <SectionCard id="departments-loading" title="By department"><SkeletonLines lines={6} label="Loading the departments" /></SectionCard>;
  } else if (refused(doc)) {
    body = <SectionCard id="departments-denied" title="By department"><Denied what="the documents of the departments" /></SectionCard>;
  } else if (!doc.data) {
    body = <ErrorState title="Unavailable" message={errorMessage(doc.error)} onRetry={canRetry(doc.error) ? doc.retry : undefined} />;
  } else if (isEmpty(doc.data)) {
    body = <EmptyState kind="firstUse" icon={FileText} title="No documents" action={<Button variant="primary" href={link(LIBRARY)}>Open library</Button>} />;
  } else {
    body = (
      <>
        {doc.error != null && <ErrorState compact title="Unavailable" message="What is shown may be out of date." onRetry={canRetry(doc.error) ? doc.retry : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
        <MatrixCard data={doc.data} measure={measure} onMeasure={onMeasure} />
      </>
    );
  }
  return (
    <div className="flex flex-col gap-[16px]">
      {body}
      <Frameworks posture={posture} scoped={scoped} />
    </div>
  );
}

