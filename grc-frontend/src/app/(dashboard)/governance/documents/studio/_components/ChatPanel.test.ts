import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// the chat composer carries no line under the message box (user request, 2026-10-18): kept out on every merge
const src = readFileSync(new URL('./ChatPanel.tsx', import.meta.url), 'utf8');

test('the composer shows no references count, entity chip, ideas toggle or key hint', () => {
  for (const gone of ["'reference')} attached", 'Entity: {', 'Hide ideas', 'ideasOpen', 'Enter to send', 'Attach or drop any file']) {
    assert.ok(!src.includes(gone), `still in ChatPanel.tsx: ${gone}`);
  }
});

test('the composer keeps the paperclip, drop, paste, Enter to send and Stop', () => {
  for (const kept of ['aria-label="Attach files"', 'onDrop=', 'onPaste=', "e.key === 'Enter' && !e.shiftKey", 'props.onStop', 'placeholder=']) {
    assert.ok(src.includes(kept), `missing from ChatPanel.tsx: ${kept}`);
  }
});

test('the message box grows with what is typed or pasted (user request, 2026-10-21), so nobody has to drag it bigger', () => {
  assert.ok(src.includes('useAutoGrow(area, text'));
  assert.ok(!src.includes('resize-y'));
});

test('the composer button is named apart from the top bar quick ask, also called Send', () => {
  assert.ok(src.includes('aria-label="Send to Comply Agent"'));
  assert.ok(!src.includes('aria-label="Send"'));
});
