import clsx from 'clsx';

type Variant = 'white' | 'blue';

const P: Record<Variant, { fill: string; stroke: string; feet: string; chest: string; ear: string; cheek: string; smile: string; armHi: string }> = {
  white: { fill: '#fff', stroke: '#005B96', feet: '#005B96', chest: '#EFF5FA', ear: '#EFF5FA', cheek: '#B3CDE0', smile: '#014A81', armHi: '#fff' },
  blue: { fill: '#005B96', stroke: '#03396C', feet: '#011F4B', chest: '#B3CDE0', ear: '#3279A3', cheek: '#8BB3CC', smile: '#011F4B', armHi: '#3279A3' },
};

/** Front-facing mascot, both arms raised (waves / grips the card edge). */
export function MascotFront({ variant, className }: { variant: Variant; className?: string }) {
  const p = P[variant];
  return (
    // No drop-shadow filter: the arm wave animates inside this svg, and a
    // filter would force a filtered re-raster every frame (jank).
    <svg viewBox="0 0 96 110" className={clsx('overflow-visible', className)}>
      <rect x="38" y="83" width="9" height="17" rx="4.5" fill={p.fill} stroke={p.stroke} strokeWidth="2.4" />
      <rect x="51" y="83" width="9" height="17" rx="4.5" fill={p.fill} stroke={p.stroke} strokeWidth="2.4" />
      <circle cx="42.5" cy="100" r="5.5" fill={p.feet} />
      <circle cx="55.5" cy="100" r="5.5" fill={p.feet} />
      <rect x="29" y="53" width="40" height="32" rx="16" fill={p.fill} stroke={p.stroke} strokeWidth="2.6" />
      <circle cx="49" cy="69" r="5.5" fill={p.chest} stroke={p.stroke} strokeWidth="2" />
      <path d="M62 59 Q79 47 79 28" fill="none" stroke={p.stroke} strokeWidth="8.5" strokeLinecap="round" />
      <path d="M62 59 Q79 47 79 28" fill="none" stroke={p.armHi} strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="79" cy="26" r="7" fill={p.fill} stroke={p.stroke} strokeWidth="2.4" />
      <g className="lg-wave">
        <path d="M34 59 Q17 47 17 28" fill="none" stroke={p.stroke} strokeWidth="8.5" strokeLinecap="round" />
        <path d="M34 59 Q17 47 17 28" fill="none" stroke={p.armHi} strokeWidth="3.6" strokeLinecap="round" />
        <circle cx="17" cy="26" r="7" fill={p.fill} stroke={p.stroke} strokeWidth="2.4" />
      </g>
      <line x1="48" y1="15" x2="48" y2="6" stroke={p.stroke} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="48" cy="4.5" r="3.6" fill="#6497B1" stroke={p.stroke} strokeWidth="1.4" className="lg-blip" />
      <circle cx="20" cy="38" r="4.5" fill={p.ear} stroke={p.stroke} strokeWidth="2" />
      <circle cx="76" cy="38" r="4.5" fill={p.ear} stroke={p.stroke} strokeWidth="2" />
      <rect x="23" y="14" width="50" height="42" rx="20" fill={p.fill} stroke={p.stroke} strokeWidth="2.8" />
      <rect x="29" y="21" width="38" height="28" rx="14" fill="#EFF5FA" />
      <circle cx="40" cy="35" r="5" fill="#011F4B" />
      <circle cx="56" cy="35" r="5" fill="#011F4B" />
      <circle cx="41.7" cy="33.1" r="1.7" fill="#fff" />
      <circle cx="57.7" cy="33.1" r="1.7" fill="#fff" />
      <circle cx="33" cy="43" r="3.2" fill={p.cheek} />
      <circle cx="63" cy="43" r="3.2" fill={p.cheek} />
      <path d="M41 43 q7 5 14 0" fill="none" stroke={p.smile} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Blue side-pose pusher: profile facing right, arms out, stepping legs. */
export function MascotSide({ className }: { className?: string }) {
  return (
    // Filterless for the same reason as MascotFront — the legs animate inside.
    <svg viewBox="0 0 100 110" className={clsx('overflow-visible', className)}>
      <g className="lg-step-a">
        <path d="M44 80 L36 97" stroke="#03396C" strokeWidth="8" strokeLinecap="round" />
        <circle cx="35" cy="100" r="5.5" fill="#011F4B" />
      </g>
      <g className="lg-step-b">
        <path d="M54 80 L62 97" stroke="#03396C" strokeWidth="8" strokeLinecap="round" />
        <circle cx="63" cy="100" r="5.5" fill="#011F4B" />
      </g>
      <g transform="rotate(8 48 60)">
        <rect x="30" y="50" width="38" height="32" rx="15" fill="#005B96" stroke="#03396C" strokeWidth="2.6" />
        <circle cx="52" cy="66" r="5" fill="#B3CDE0" stroke="#03396C" strokeWidth="2" />
        <path d="M60 56 L86 50" stroke="#03396C" strokeWidth="8.5" strokeLinecap="round" />
        <circle cx="88" cy="49" r="6.5" fill="#005B96" stroke="#03396C" strokeWidth="2.4" />
        <path d="M60 68 L86 64" stroke="#03396C" strokeWidth="8.5" strokeLinecap="round" />
        <circle cx="88" cy="63" r="6.5" fill="#005B96" stroke="#03396C" strokeWidth="2.4" />
        <line x1="46" y1="12" x2="44" y2="3" stroke="#03396C" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="44" cy="1.5" r="3.4" fill="#6497B1" stroke="#03396C" strokeWidth="1.4" />
        <circle cx="20" cy="34" r="4.5" fill="#3279A3" stroke="#03396C" strokeWidth="2" />
        <rect x="22" y="12" width="48" height="40" rx="19" fill="#005B96" stroke="#03396C" strokeWidth="2.8" />
        <rect x="42" y="19" width="26" height="26" rx="12" fill="#EFF5FA" />
        <circle cx="58" cy="31" r="4.8" fill="#011F4B" />
        <circle cx="59.6" cy="29.4" r="1.6" fill="#fff" />
        <path d="M52 40 q5 3.5 10 -1" fill="none" stroke="#011F4B" strokeWidth="2.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
