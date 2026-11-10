'use client';

// The categories a questionnaire can be filed under: the organisation's own list (Settings, "Fields and dropdown lists on a
// supplier"), or the shipped ones until it sets its own. A category picks the card's icon and files the questionnaire.
import { listOptions, useModuleSettings } from '@/components/settings/CustomFields';

const SHIPPED = ['security', 'privacy', 'compliance', 'operational', 'financial', 'general'];

export const categoryLabel = (category: string): string => category.charAt(0).toUpperCase() + category.slice(1);

/** The choices, with `current` kept among them even if the organisation has since taken it off its list. */
export function useCategories(current?: string | null): Array<{ value: string; label: string }> {
  const { data } = useModuleSettings('vendors');
  return listOptions(data, 'questionnaire_category', current, SHIPPED.map((c) => ({ value: c, label: categoryLabel(c) })))
    .map((o) => ({ value: o.value, label: o.label }));
}
