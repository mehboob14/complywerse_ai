'use client';

// The Administration shell: the list of sections beside every page that is a section's (G12 pattern A, "settings layout"). The list is drawn from
// lib/adminSections.ts, the same registry as the sidebar's Administration menu, so the two cannot disagree. From 1280px it is a sticky column on
// the left; below that it is a "Section" select above the page (the sidebar is a 64px rail between 1024 and 1279, so the room is for the page).
// Pages that are not a section's (the scanner onboarding pages, the style guide, the old forwards) and the workflow builder (full width, outside
// /admin) are drawn as they are. Only administrators get the list: nobody else has a way into the other sections (the menu is administrators'
// only and no right changes here), and a page opened by its address looks as it did.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { usePermissions } from '@/hooks/usePermissions';
import { Select } from '@/components/ui/ds/Select';
import { groupedSections, sectionOfPath, visibleSections } from '@/lib/adminSections';

const ROW = 'flex min-h-ds-control items-center rounded-ds-control px-[8px] text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring';
const ROW_ON = 'bg-ds-primary-soft font-[600] text-ds-primary-text';
const ROW_OFF = 'text-ds-fg hover:bg-ds-surface-hover';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, isLoading } = usePermissions();
  const current = sectionOfPath(pathname);
  if (!current || current.layout === 'full') return <>{children}</>;
  if (!isLoading && !isAdmin) return <>{children}</>;

  const groups = groupedSections(visibleSections({ isAdmin }));
  return (
    <div className="xl:grid xl:grid-cols-[208px_minmax(0,1fr)] xl:items-start xl:gap-x-[24px]">
      <div className="xl:sticky xl:top-[16px]">
        {!isLoading && (
          <>
          <nav aria-label="Administration sections" className="hidden xl:block">
            <p className="px-[8px] pb-[8px] text-ds-label font-[600] text-ds-fg-muted">Administration</p>
            {groups.map(({ group, sections }) => (
              <div key={group.id} className="pb-[12px]">
                <p className="px-[8px] pb-[2px] text-ds-label text-ds-fg-muted">{group.label}</p>
                <ul className="m-0 list-none p-0">
                  {sections.map((section) => {
                    const on = section.id === current.id;
                    return (
                      <li key={section.id}>
                        <Link href={section.url} aria-current={on ? 'page' : undefined} className={clsx(ROW, on ? ROW_ON : ROW_OFF)}>{section.label}</Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="pb-[12px] xl:hidden">
            <Select aria-label="Administration section" value={current.url} onChange={(e) => router.push(e.target.value)}>
              {groups.map(({ group, sections }) => (
                <optgroup key={group.id} label={group.label}>
                  {sections.map((section) => <option key={section.id} value={section.url}>{section.label}</option>)}
                </optgroup>
              ))}
            </Select>
          </div>
          </>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
