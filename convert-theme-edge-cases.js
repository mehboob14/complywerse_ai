const fs = require('fs');
const path = require('path');

const files = [
  'grc-frontend/src/app/(dashboard)/governance/documents/[id]/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/documents/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/approvals/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/attestations/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/committees/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/mappings/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/regulatory-changes/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/regulatory-feeds/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/reviews/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/workflows/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/committees/[id]/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/regulatory-changes/[id]/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/attestations/campaigns/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/attestations/campaigns/[id]/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/attestations/complete/[id]/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/reviews/calendar/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/committees/actions/page.tsx',
  'grc-frontend/src/app/(dashboard)/governance/committees/meetings/[id]/page.tsx',
];

const replacements = [
  // Gradients
  [/from-purple-900\/20 to-blue-900\/20/g, 'from-purple-50 to-blue-50'],
  [/from-blue-900\/20 to-cyan-900\/20/g, 'from-blue-50 to-cyan-50'],
  [/from-green-900\/20 to-emerald-900\/20/g, 'from-green-50 to-emerald-50'],
  // Text color patterns remaining
  [/text-slate-200/g, 'text-gray-800'],
  [/text-gray-400/g, 'text-gray-700'],
];

files.forEach((file) => {
  const fullPath = path.join('c:\\Users\\Admin\\Documents\\GRC-Tenant', file);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, 'utf8');
    replacements.forEach(([pattern, replacement]) => {
      content = content.replace(pattern, replacement);
    });
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✓ Edge cases: ${file}`);
  }
});

console.log('Edge case conversions complete!');

