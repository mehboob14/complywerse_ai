// node --test "src/app/(dashboard)/complychat/_chat/chatPages.test.ts"
// Source-text pins for the Comply Agent page (the files agent-chat wrote): the kit's rules (no class the shell rewrites, nothing under 12px, no bare outline-none), no native
// dialogs, nothing that appears only on hover, no vendor, model, SQL or technical word on a screen, no console output (a chat is never logged), and the few contracts a
// screenshot cannot show: `q` is asked once and taken out of the address, a refusal is never told to rephrase, a deleted chat is only dropped after the server said so for
// a chat with files, Stop and Retry exist, and the chats are touched in one place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(`${ROOT}${file}`, 'utf8');
const FILES = [
  ...(readdirSync(`${ROOT}_chat`) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => `_chat/${f}`),
  'page.tsx',
];

/** The words a person can read in a source file (the reading of lib/uxContent.test.ts): JSX text and string literals that hold a space; comments are dropped first. */
function visible(source: string, jsx: boolean): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  if (jsx) {
    let stripped = code;
    for (let before = ''; before !== stripped; ) { before = stripped; stripped = stripped.replace(/\{(?:[^{}<>]|=>)*\}/g, ' '); }
    for (const m of Array.from(stripped.matchAll(/>([^<>]+)</g))) if (!/=>|===|;|\b(?:return|const|import|export|new)\b/.test(m[1])) out.push(m[1]);
  }
  for (const m of Array.from(code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g))) out.push(m[2]);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.includes(' '));
}

test('the chat files follow the kit\'s rules: no class the shell rewrites, nothing under 12px, no bare outline-none', () => {
  assert.ok(FILES.length >= 15, FILES.join());
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native confirm, alert or prompt, no action that exists only on hover, no governance-light', () => {
  for (const f of FILES) {
    const source = read(f);
    assert.doesNotMatch(source, /\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w.])(?:alert|prompt)\(/, `${f}: a native dialog`);
    if (!/useConfirm/.test(source)) assert.doesNotMatch(source, /(?<![\w.])confirm\(/, `${f}: a native confirm (the kit's is useConfirm)`);
    assert.doesNotMatch(source, /opacity-0[^'"`]*group-hover|group-hover:opacity|hover:opacity-100/, `${f}: hover-only`);
    assert.doesNotMatch(source, /governance-light/, f);
  }
});

test('a screen never names a vendor, a model, SQL or a technical word, and never tells a refused person to rephrase', () => {
  const WORDS = /\b(?:open\s?ai|gpt|anthropic|claude|qdrant|sql|query|queries|database|table name|api key|token|endpoint|stack trace|uuid)\b/i;
  for (const f of FILES.filter((x) => !/chatApi|chatStore/.test(x))) {        // the request and storage files hold headers and keys, no screen words
    const shown = visible(read(f), f.endsWith('.tsx'));
    const hit = shown.find((s) => WORDS.test(s));
    assert.equal(hit, undefined, `${f}: ${hit}`);
    const rephrase = shown.find((s) => /rephras/i.test(s));
    assert.equal(rephrase, undefined, `${f}: ${rephrase}`);
  }
});

test('no console output anywhere in the page: a chat is never logged', () => {
  for (const f of FILES) assert.doesNotMatch(read(f), /\bconsole\.(?:log|info|warn|error|debug)\(/, f);
});

test('the chats are read and written in one place, and only the request file reads the sign-in', () => {
  for (const f of FILES) {
    const touches = /localStorage|sessionStorage/.test(read(f));
    assert.equal(touches, f === '_chat/chatStore.ts' || f === '_chat/chatApi.ts', `${f}: browser storage`);
  }
  assert.match(read('_chat/chatApi.ts'), /getItem\('token'\)/);
  assert.doesNotMatch(read('_chat/chatStore.ts'), /getItem\('token'\)/);
});

test('`?q=` is asked once in a new chat and then taken out of the address; the same words asked later are asked again', () => {
  const page = read('_chat/ChatPage.tsx');
  assert.match(page, /questionFromAddress\(search\.toString\(\)\)/);
  assert.match(page, /const id = startNew\(\);\s*void submit\(id, wantedQuestion\);\s*window\.history\.replaceState\(null, '', addressWith\(window\.location\.pathname, window\.location\.search, \{ q: null \}\)\)/);
  assert.match(page, /if \(taken\.current === wantedQuestion\) return;/, 'a strict-mode double run asks once');
  assert.match(page, /if \(!wantedQuestion\) \{ taken\.current = null; return; \}/, 'the memory is cleared when the address has no question');
  assert.doesNotMatch(page, /setTimeout\(\(\) => submit/, 'no question is sent from a timer on stale state');
});

test('the refusal says why in plain words and offers to edit; a failure offers Retry unless it cannot help; a long wait offers Stop', () => {
  const view = read('_chat/MessageView.tsx');
  assert.match(view, /Edit question/);
  assert.match(view, /Nothing from this question was sent\./);
  assert.match(view, /message\.retryable === false/);
  assert.match(view, /You can press Stop/);
  assert.match(read('_chat/Composer.tsx'), /onClick=\{onStop\}>Stop</);
  assert.match(read('_chat/askOutcome.ts'), /This question includes information that is not sent to the AI\./);
});

test('a chat that had files is dropped only after the server deleted them; a failed delete keeps it and offers Retry', () => {
  const hook = read('_chat/useChat.ts');
  assert.match(hook, /if \(!result\.ok && hadFiles\) \{/);
  assert.match(hook, /retry: result\.failure\.retry \? \(\) => void removeNow\(id\) : undefined/);
  assert.match(hook, /confirmLabel: 'Delete chat',\s*tone: 'danger'/);
});

test('a second question is not sent while one is coming, and a failed turn is asked again in place (no second copy of the question)', () => {
  const hook = read('_chat/useChat.ts');
  assert.match(hook, /if \(busyRef\.current\) return \{ accepted: false, message: 'Wait for the answer to finish, or press Stop\.' \}/);
  assert.match(hook, /kind: 'replace', messageId/);
  assert.match(hook, /historyFor\(chat\.messages\.slice\(0, Math\.max\(0, index - 1\)\)\)/, 'a retry sends the turns before its own question');
});

test('the conversation is a labelled log that keyboard users can scroll, the box has a label, and every icon button is named', () => {
  const page = read('_chat/ChatPage.tsx');
  assert.match(page, /role="log"[\s\S]{0,120}aria-live="polite"/);
  assert.match(page, /tabIndex=\{0\}/);
  const composer = read('_chat/Composer.tsx');
  assert.match(composer, /<label htmlFor="complychat-message" className="sr-only">Message to Comply Agent<\/label>/);
  for (const f of FILES) for (const m of Array.from(read(f).matchAll(/<IconButton\b[^>]*>/g))) assert.match(m[0], /label=/, `${f}: ${m[0]}`);
});

test('a scroller that holds screen-reader-only words is positioned, so they cannot make the whole window scroll (measured: a 6-answer chat grew the document to 4,246px)', () => {
  assert.match(read('_chat/ChatPage.tsx'), /className="relative min-h-0 flex-1 overflow-y-auto/);
  assert.match(read('_chat/Composer.tsx'), /<div className="relative border-t border-ds-border/);
  assert.match(read('_chat/MessageView.tsx'), /sr-only/);
  assert.match(read('_chat/ChatPage.tsx'), /h-\[calc\(100vh-5\.5rem\)\]/, 'the page is as high as the shell leaves room for (the top bar is 47px, <main> pads 20px twice)');
});

test('the Cyber Assurance copy is untouched and the chats still use its keys', () => {
  assert.match(read('_chat/chatStore.ts'), /'complychat\.conversations\.v2'/);
  assert.match(read('_chat/chatStore.ts'), /'complychat\.activeConversation\.v2'/);
});
