'use client';

/**
 * Failure isolation for a dashboard lens. If anything inside throws while rendering (a
 * malformed payload, an unexpected null), only THIS card falls back to the standard
 * "didn't load" state — the rest of the Performance dashboard keeps rendering.
 *
 * Data-fetch failures never reach here (react-query keeps them in `isError`); this is the
 * backstop for render-time exceptions.
 */
import { Component, type ReactNode } from 'react';
import { Card, Unavailable } from './kit';

type Props = { title: string; href?: string; className?: string; children: ReactNode };

export class LensBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Quiet by design — the card shows its own fallback; the console keeps the detail for debugging.
    console.error(`[dashboard] "${this.props.title}" lens failed to render`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { title, href, className } = this.props;
    return (
      <Card title={title} className={className}>
        <Unavailable what={title} href={href} />
      </Card>
    );
  }
}
