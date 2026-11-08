'use client';

// The maturity model workbook (xlsx_maturity): the workbook viewer of the older detail page (summary and detail rows, evidence per row, AI recommendation) behind the lens contract.
import XlsxMaturityViewer from '@/app/(dashboard)/compliance/assessments/[id]/XlsxMaturityViewer';
import type { LensProps } from '../lens';
import { useAssessment } from './useFacts';

export default function WorkbookLens({ assessmentId }: LensProps) {
  const a = useAssessment(assessmentId).data;
  return a ? <XlsxMaturityViewer assessmentId={assessmentId} assessmentItems={a.items as any} /> : null;
}
