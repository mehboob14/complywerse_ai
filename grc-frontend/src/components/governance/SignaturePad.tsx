'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * A box to sign in with a mouse, a finger or a pen. `onChange` gets the signature as a PNG data URL when a stroke
 * ends, and null when the box is cleared. Used by every sign-off and acknowledgement; the server checks the image
 * and seals it (services/esign.py), so this only has to draw.
 */
export default function SignaturePad({
  onChange,
  height = 160,
  disabled = false,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const width = useRef(0);
  const notify = useRef(onChange);
  notify.current = onChange;

  const reset = useCallback(() => {
    const canvas = canvasRef.current;
    const w = canvas?.parentElement?.clientWidth;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !w) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = w * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    width.current = w;
    notify.current(null);
  }, [height]);

  useEffect(() => {
    reset();
    // Only a change of width clears the box (a phone's keyboard opening changes the height, not the signature).
    const onResize = () => {
      if (canvasRef.current?.parentElement?.clientWidth !== width.current) reset();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [reset]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d');
    if (disabled || !ctx) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a stroke is still drawn without capture */ }
    drawing.current = true;
    const p = at(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01); // a tap leaves a dot
    ctx.stroke();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d');
    if (!drawing.current || !ctx) return;
    const p = at(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    notify.current(e.currentTarget.toDataURL('image/png'));
  };

  return (
    <div>
      <div className={`overflow-hidden rounded-lg border border-slate-300 bg-white ${disabled ? 'opacity-60' : ''}`}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Signature box: draw your signature with a mouse, finger or pen"
          className="block w-full cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>
      <button type="button" onClick={reset} disabled={disabled} className="mt-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50">
        Clear signature
      </button>
    </div>
  );
}
