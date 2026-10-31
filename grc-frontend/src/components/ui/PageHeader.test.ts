// node --test "src/components/ui/PageHeader.test.ts"
// PageHeader is shared: five Access Reviews pages (another agent's) and AI Governance render it with no variant. Its default, the "classic" head, must
// stay exactly the markup and classes it had, so this test pins the source of the classic branch to a copy taken from commit 1cacd571, the one
// before the "page" variant was added. If you change the classic head on purpose, change the copy below and look at every importer first
// (see the inventory of importers of components/ui/PageHeader).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = readFileSync('src/components/ui/PageHeader.tsx', 'utf8').replace(/\r\n/g, '\n');

const ICON_COLORS = `const iconColorClasses = {
  primary: 'text-primary-600',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-rose-600',
  info: 'text-cyan-600',
};`;

const CLASSIC_HEAD = `  return (
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
  );`;

test('the classic head keeps the markup and the classes it had', () => {
  assert.ok(source.includes(ICON_COLORS), 'iconColorClasses changed');
  assert.ok(source.includes(CLASSIC_HEAD), 'the classic branch changed');
});

test('classic is the default variant, and the page variant leaves before the classic markup is reached', () => {
  assert.match(source, /variant = 'classic'/);
  const leave = source.indexOf("if (variant === 'page') {");
  assert.ok(leave > 0, 'the early return for variant="page" is gone');
  assert.ok(leave < source.indexOf(CLASSIC_HEAD), 'the page variant must return before the classic markup');
  assert.match(source, /if \(variant === 'page'\) \{\s*return <PageHeading /);
});

test('no prop of the classic head was renamed, removed or given another default', () => {
  for (const line of [
    'title: string;', 'subtitle?: string;', 'icon?: LucideIcon;', "iconColor?: 'primary' | 'success' | 'warning' | 'danger' | 'info';",
    'actions?: ReactNode;', 'filters?: ReactNode;', 'breadcrumbs?: BreadcrumbItem[];', 'showBreadcrumb?: boolean;', 'className?: string;',
  ]) assert.ok(source.includes(`  ${line}\n`), line);
  for (const line of ['  icon: Icon,', "  iconColor = 'primary',", '  showBreadcrumb = true,']) assert.ok(source.includes(`${line}\n`), line);
  assert.match(source, /export function PageHeader\(/);
  assert.match(source, /export default PageHeader;/);
  assert.match(source, /export interface PageHeaderProps/);
});

test('the page variant is drawn by ds/PageHeading.tsx, a file the kit guard reads (tokens only)', () => {
  assert.ok(existsSync('src/components/ui/ds/PageHeading.tsx'));
  assert.match(source, /import \{ PageHeading \} from '\.\/ds\/PageHeading';/);
});
