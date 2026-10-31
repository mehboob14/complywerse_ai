'use client';

import { type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import { ReactNode } from 'react';
import { PageHeading } from './ds/PageHeading';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  actions?: ReactNode;
  /** Filter row rendered below the title (typical use: a row of MultiSelectDropdown chips) */
  filters?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  showBreadcrumb?: boolean;
  /** 'classic' (the default) is the header every page had until now and stays exactly as it was. 'page' is the unified head of the new standard
   *  (ds/PageHeading): it draws title, meta, info, back, chips, actions and className, and ignores subtitle, icon, filters and the breadcrumbs. */
  variant?: 'classic' | 'page';
  /** variant="page": one line of facts, not prose ("44 documents · updated 5 d ago") */
  meta?: ReactNode;
  /** variant="page": what the page used to explain in a sentence, shown from an (i) beside the title */
  info?: string;
  /** variant="page": a link back to the list the record belongs to ("Back to vendors") */
  back?: { href: string; label: string };
  /** variant="page": status pills under the title */
  chips?: ReactNode;
  className?: string;
}

const iconColorClasses = {
  primary: 'text-primary-600',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-rose-600',
  info: 'text-cyan-600',
};

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  iconColor = 'primary',
  actions,
  filters,
  breadcrumbs,
  showBreadcrumb = true,
  variant = 'classic',
  meta,
  info,
  back,
  chips,
  className,
}: PageHeaderProps) {
  if (variant === 'page') {
    return <PageHeading title={title} meta={meta} info={info} back={back} chips={chips} actions={actions} className={className} />;
  }

  return (
    <div className={clsx('mb-4', className)}>
      {showBreadcrumb && (
        <div className="mb-2.5">
          <Breadcrumb items={breadcrumbs} />
        </div>
      )}
      
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className={clsx(
              'flex-shrink-0',
              iconColorClasses[iconColor]
            )}>
              <Icon size={20} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-black tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 max-w-2xl text-sm leading-snug text-slate-600">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        
        {actions && (
          <div className="flex flex-shrink-0 items-center gap-2.5">
            {actions}
          </div>
        )}
      </div>

      {filters && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {filters}
        </div>
      )}
    </div>
  );
}

export default PageHeader;
