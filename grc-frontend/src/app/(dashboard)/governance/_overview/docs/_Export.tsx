'use client';

// The export of the Overview: a menu of a PDF summary (GET /governance/document-overview/export/pdf, the figures of the scope for a committee pack) and two CSV files for the scope on screen. "Departments" is the table of this view with every group of columns (made here from
// the figures already loaded, so it is exactly what the person sees); "Documents" is one row for each document the person may read, from the server (GET
// /governance/document-overview/export, which counts what the figures count). A failed download says so, with Retry; nothing is ever saved from a failed request.
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import apiClient from '@/lib/api';
import { Menu, useNotify } from '@/components/ui/ds';
import { EXPORT_ENDPOINT } from './_board';
import { csvName } from './_csv';
import { columnsFor, matrixCsv } from './_matrix';
import { scopeParams, type Overview } from './_model';

/** Hands the file to the browser as a download. */
function save(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExportMenu({ data }: { data: Overview }) {
  const notify = useNotify();
  const departments = () => save(csvName('Departments', data.scope.name), new Blob([matrixCsv(data, columnsFor('all', data))], { type: 'text/csv;charset=utf-8' }));
  const documents = async (): Promise<void> => {
    try {
      const res = await apiClient.get(EXPORT_ENDPOINT, { params: scopeParams(data.scope.value), responseType: 'blob' });
      save(csvName('Documents', data.scope.name), res.data as Blob);
    } catch (e) {
      notify.error(e, { title: "Couldn't export the documents", retry: () => { void documents(); } });
    }
  };
  const summary = async (): Promise<void> => {
    try {
      const res = await apiClient.get(`${EXPORT_ENDPOINT}/pdf`, { params: scopeParams(data.scope.value), responseType: 'blob' });
      save(csvName('Overview', data.scope.name, new Date(), 'pdf'), res.data as Blob);
    } catch (e) {
      notify.error(e, { title: "Couldn't make the PDF", retry: () => { void summary(); } });
    }
  };
  return (
    <Menu
      label="Export"
      items={[
        { key: 'summary', label: 'Summary (PDF)', icon: FileText, onSelect: () => { void summary(); } },
        { key: 'departments', label: 'Departments (CSV)', icon: FileSpreadsheet, onSelect: departments },
        { key: 'documents', label: 'Documents (CSV)', icon: Download, onSelect: () => { void documents(); } },
      ]}
    />
  );
}
