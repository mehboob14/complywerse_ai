'use client';

// A department picker for a form: the kit's Combobox over every department in tree order, each named by its whole path ("Operations › Support") with its
// level under the name ("Sub-department", in the organisation's own words), so two units of the same name can be told apart. It reads the departments (the
// list Governance → Settings and Administration share) and the names of the levels. `first` is an option of its own before the departments that stands for
// none ("Whole organisation"); without it, choosing the chosen department again clears it. The value is the department's id as text, '' for none.
// Used by the approval rules' editor and tester (Governance → Settings) and the exception form.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { departmentsApi } from '@/lib/api';
import { departmentPickItems, departmentPlaceholder } from '@/lib/departments';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { Combobox, ErrorState } from '@/components/ui/ds';
import { useAdminDepartments } from '@/components/admin/DepartmentForm';

const NONE = 'none';                                                   // the value of the `first` option: a department's value is its id

/** What the organisation calls the levels of its department tree, top first (anyone signed in reads them). */
function useLevelLabels() {
  return useQuery({ queryKey: ['department-levels'], queryFn: async () => (await departmentsApi.levels()).data.labels, staleTime: 5 * 60 * 1000 });
}

export function DepartmentSelect({ label, value, onChange, first, placeholder = 'Choose a department', keep = [], disabled = false }: {
  /** the control's name for a screen reader */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** an option before the departments that stands for none: "Whole organisation" */
  first?: { label: string; description?: string };
  /** what it says while none is chosen and there is no `first` */
  placeholder?: string;
  /** departments that are switched off but still show: the one a record sits in */
  keep?: readonly number[];
  disabled?: boolean;
}) {
  const departments = useAdminDepartments();
  const levels = useLevelLabels();
  const options = useMemo(() => {
    const list = departmentPickItems(departments.data ?? [], { labels: levels.data, keep }).map(({ subLabel, ...item }) => ({ ...item, description: subLabel }));
    return first ? [{ value: NONE, label: first.label, description: first.description }, ...list] : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keep` is a small list made on every render; its content is what matters
  }, [departments.data, levels.data, first?.label, first?.description, keep.join(',')]);

  if (departments.isError && !departments.data) {
    return <ErrorState compact title="Couldn't load the departments" message={errorMessage(departments.error)} onRetry={() => { void departments.refetch(); }} />;
  }
  const count = departments.data?.length ?? 0;
  return (
    <Combobox
      label={label}
      options={options}
      value={value === '' ? (first ? NONE : null) : value}
      onChange={(v) => onChange(v === null || v === NONE ? '' : v)}
      clearable={!first}
      disabled={disabled}
      searchPlaceholder="Search departments"
      placeholder={departments.isLoading || count === 0 ? departmentPlaceholder({ loading: departments.isLoading, count }) : placeholder}
    />
  );
}
