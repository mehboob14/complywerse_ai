const fs = require('fs');
const path = require('path');

// Files to convert
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
];

const replacements = [
  [/text-slate-400(?![0-9])/g, 'text-gray-600'],
  [/text-slate-300(?![0-9])/g, 'text-gray-800'],
  [/text-slate-500(?![0-9])/g, 'text-gray-700'],
  [/text-white(?![0-9])/g, 'text-black'],
  [/bg-slate-900(?![0-9])/g, 'bg-white'],
  [/bg-slate-800(?![0-9])/g, 'bg-white'],
  [/bg-slate-700(?![0-9])/g, 'bg-gray-100'],
  [/bg-slate-600(?![0-9])/g, 'bg-gray-100'],
  [/border-slate-700(?![0-9])/g, 'border-gray-300'],
  [/border-slate-600(?![0-9])/g, 'border-gray-300'],
  [/hover:bg-slate-700/g, 'hover:bg-gray-200'],
  [/hover:bg-slate-800/g, 'hover:bg-gray-200'],
  [/hover:text-white/g, 'hover:text-black'],
];

files.forEach((file) => {
  const fullPath = path.join('c:\\Users\\Admin\\Documents\\GRC-Tenant', file);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, 'utf8');
    replacements.forEach(([pattern, replacement]) => {
      content = content.replace(pattern, replacement);
    });
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✓ ${file}`);
  } else {
    console.log(`✗ ${file} (not found)`);
  }
});

console.log('\nConversion complete!');
