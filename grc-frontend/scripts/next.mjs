#!/usr/bin/env node
// Run `next` with a larger V8 heap on any OS.
//
// The old scripts used `set NODE_OPTIONS=... && next dev`, which only works in
// cmd.exe: on Linux `set` does nothing useful and next ran with the default
// heap. NODE_OPTIONS (not a CLI flag) so Next's build workers inherit it too.
//   NEXT_MAX_OLD_SPACE_MB=3072 node scripts/next.mjs build
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const heap = `--max-old-space-size=${process.env.NEXT_MAX_OLD_SPACE_MB || 4096}`;
const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, heap].filter(Boolean).join(' '),
};

const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
