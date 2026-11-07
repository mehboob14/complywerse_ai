// Help Desk HTML sanitizer (bank-grade B3 fix — stored XSS).
//
// Ticket descriptions, agent/requester replies and INGESTED EMAIL bodies are
// rendered with `dangerouslySetInnerHTML` in the agent console and the requester
// portal. Those strings are attacker-controllable: a requester, or any external
// party who emails the support address, can inject `<script>` / `onerror=` /
// `<iframe>` / `javascript:` payloads that would otherwise execute inside an
// authenticated agent's session. EVERY such string must pass through
// `sanitizeHtml()` before it reaches `dangerouslySetInnerHTML`.
//
// Browser-only `dompurify` (NOT isomorphic/jsdom — that bundles jsdom into every
// HD page's static export and breaks `next build`). These are "use client" pages
// that fetch ticket/reply/email content in the browser, so sanitization only has
// to run client-side: during SSG/SSR there is no real untrusted content yet, and
// the browser re-renders (and sanitizes) once the data arrives. On the server we
// return "" (fail-closed) so nothing unsanitized is ever emitted.
//
// NOTE: `dompurify` + `@types/dompurify` are declared in grc-frontend/package.json
// but not installed in this checkout — the droplet runs `npm install` before
// `npm run build`. The `@ts-ignore` lets `tsc --noEmit` pass pre-install.
// @ts-ignore -- resolved at build time after `npm install`
import DOMPurify from "dompurify";

// Strict allowlist: only basic text formatting survives. Everything else
// (scripts, iframes, objects, forms, style, event-handler attributes, data-*,
// inline styles) is stripped. Links are limited to http(s)/mailto by
// ALLOWED_URI_REGEXP; DOMPurify drops `javascript:` and other dangerous schemes.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "b", "i", "u", "p", "br", "ul", "ol", "li", "a",
    "blockquote", "code", "pre", "span", "strong", "em",
  ],
  ALLOWED_ATTR: ["href", "target", "rel"],
  // Only absolute http(s) and mailto links are permitted; strips javascript:,
  // data:, vbscript:, etc.
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  // Defence in depth — explicit deny on top of the tag/attr allowlist.
  FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "form", "input", "textarea", "svg", "math", "link", "base"],
  FORBID_ATTR: ["style", "onerror", "onload", "onclick", "onmouseover", "onfocus", "srcset"],
  // Keep the readable text of any stripped tag; never return an executable node.
  KEEP_CONTENT: true,
  RETURN_TRUSTED_TYPE: false,
};

// Harden any surviving anchor: force a safe rel and open externally, so a
// sanitized link can't be used for tab-nap / referrer leakage.
let hookInstalled = false;
function ensureHook() {
  if (hookInstalled) return;
  try {
    DOMPurify.addHook("afterSanitizeAttributes", (node: any) => {
      if (node && node.tagName === "A" && node.getAttribute && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer nofollow");
      }
    });
    hookInstalled = true;
  } catch {
    // addHook unavailable (shouldn't happen) — allowlist config still applies.
  }
}

/**
 * Sanitize untrusted HTML before it is handed to `dangerouslySetInnerHTML`.
 * Returns a safe HTML string containing only the allow-listed formatting tags.
 * Never throws; on any failure it falls back to the empty string (fail-closed).
 */
export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  // Browser-only: DOMPurify needs a DOM. On the server (SSG/SSR) there is no real
  // untrusted content to render yet, so fail closed — the client re-renders +
  // sanitizes once the data loads.
  if (typeof window === "undefined") return "";
  try {
    ensureHook();
    return DOMPurify.sanitize(html, SANITIZE_CONFIG) as string;
  } catch {
    return "";
  }
}

export default sanitizeHtml;
