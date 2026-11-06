'use client';

// A connector's own brand mark, bundled at public/connectors/<id>.svg (the
// reference's integration-logo set). Same-origin only — no logo CDN, so opening
// the catalogue fires no third-party request. A missing file falls back to the
// vendor's initials; drop a new SVG in and it renders with no code change.

import { useState } from 'react';

function initials(name: string): string {
  const tokens = (name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
  return (name.replace(/\s/g, '').slice(0, 2) || '?').toUpperCase();
}

export function BrandLogo({ id, name = '', size = 48 }: { id?: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!id || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-lg bg-slate-100 font-bold text-slate-500"
        style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
        aria-hidden
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-200"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/connectors/${id}.svg`}
        alt=""
        width={Math.round(size * 0.66)}
        height={Math.round(size * 0.66)}
        style={{ width: Math.round(size * 0.66), height: Math.round(size * 0.66) }}
        className="object-contain"
        loading="eager"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
