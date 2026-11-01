#!/usr/bin/env node
/*
 * Security guard — added after the 2026 postcss supply-chain incident.
 * An obfuscated require()-based loader was appended to postcss.config.js behind a
 * wall of whitespace; Next loads that file on every dev/build/start, so the loader
 * ran (phoned home + re-wrote itself) and rode along in unrelated commits.
 * This refuses to run Next when any config Next loads looks tampered with.
 *   node scripts/guard-postcss.js            check the real files
 *   node scripts/guard-postcss.js <file...>  check other files (used by the self-test)
 */
const fs = require('fs');
const path = require('path');

const FRONTEND = path.resolve(__dirname, '..');
const POSTCSS_CLEAN = [
  'module.exports = {',
  '  plugins: {',
  '    tailwindcss: {},',
  '    autoprefixer: {},',
  '  },',
  '};',
].join('\n');
const MAX_LINE = 1500;
const MARKERS = [
  [/global\.o\s*=/, "loader marker global.o="],
  [/global\[\s*['"]!['"]\s*\]/, "loader marker global['!']"],
  [/_\$_[0-9A-Za-z_]+/, 'obfuscated identifier _$_xxxx'],
  [/_\$jsoPow/, 'loader marker _$jsoPow'],
  [/fromCharCode\(\s*127\s*\)/, 'loader marker fromCharCode(127)'],
  [/[ \t]{200,}/, 'run of 200+ spaces/tabs (padding trick)'],
];

const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** The reason `src` looks infected, or null. `strictPostcss` also demands the exact clean config. */
function problem(src, strictPostcss) {
  for (const [re, why] of MARKERS) if (re.test(src)) return why;
  const long = src.split(/\r?\n/).findIndex((l) => l.length > MAX_LINE);
  if (long !== -1) return `line ${long + 1} is longer than ${MAX_LINE} chars`;
  if (strictPostcss && normalize(src) !== POSTCSS_CLEAN) return 'is not the clean 6-line tailwind+autoprefixer config';
  return null;
}

const args = process.argv.slice(2);
const targets = args.length
  ? args.map((f) => ({ file: path.resolve(f), strict: path.basename(f).startsWith('postcss.config') }))
  : [
      { file: path.join(FRONTEND, 'postcss.config.js'), strict: true },
      { file: path.join(FRONTEND, 'next.config.js'), strict: false },
      { file: path.join(FRONTEND, 'tailwind.config.ts'), strict: false },
      { file: path.join(FRONTEND, '..', 'Updated_CIS_Assests', 'project', '.migration-backup', 'grc-frontend', 'postcss.config.js'), strict: true, optional: true },
    ];

let bad = 0;
for (const { file, strict, optional } of targets) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (optional && e.code === 'ENOENT') continue;
    console.error(`[guard-postcss] cannot read ${file}: ${e.message}`);
    bad++;
    continue;
  }
  const why = problem(src, strict);
  if (why) {
    console.error(`[guard-postcss] SECURITY: ${file} looks INFECTED (${src.length} bytes): ${why}.`);
    bad++;
  }
}
if (bad) {
  console.error('[guard-postcss] Aborted. Restore the clean files (postcss.config.js is 6 lines, ~83 bytes) and re-run.');
  process.exit(1);
}
console.log(`[guard-postcss] ${targets.length} config file(s) clean.`);
