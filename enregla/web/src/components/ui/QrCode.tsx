import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * Código QR generado en el cliente (sin servicios externos) y pintado como SVG.
 * Se dibuja un único <path> con los módulos oscuros.
 */
export function QrCode({ value, size = 220, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const { d, n } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    const parts: string[] = [];
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) parts.push(`M${x} ${y}h1v1h-1z`);
      }),
    );
    return { d: parts.join(''), n: qr.size };
  }, [value]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={n} height={n} fill="#ffffff" />
      <path d={d} fill="#0b1418" />
    </svg>
  );
}
