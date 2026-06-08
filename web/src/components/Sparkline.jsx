// Lightweight inline SVG sparkline (no recharts overhead — used per timeline
// card). Renders an area "route" from a numeric series.
export default function Sparkline({ data, width = 240, height = 40, color = 'var(--accent)' }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 0.0001);
  const n = data.length;
  const step = n > 1 ? width / (n - 1) : width;
  const pts = data.map((v, i) => [i * step, height - (v / max) * (height - 4) - 2]);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity="0.15" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
