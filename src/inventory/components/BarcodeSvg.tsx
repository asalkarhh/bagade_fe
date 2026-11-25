import { useId } from 'react';
import { encodeCode128 } from '../../utils/code128.ts';

export interface BarcodeSvgProps {
  code: string;
  heightMm?: number;
  className?: string;
}

export function BarcodeSvg({ code, heightMm = 10, className }: BarcodeSvgProps) {
  const titleId = useId();

  let encoded;
  try {
    encoded = encodeCode128(code);
  } catch {
    return (
      <div className="catalog-field-error" role="alert">
        Invalid barcode value: <code>{code}</code>
      </div>
    );
  }

  const barcodePath = encoded.bars
    .map((bar) => `M${bar.x} 0h${bar.width}v40H${bar.x}z`)
    .join('');

  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      className={className ?? 'product-tag__barcode-svg'}
      viewBox={`0 0 ${encoded.totalModules} 40`}
      preserveAspectRatio="none"
      style={{ blockSize: `${heightMm}mm` }}
      shapeRendering="crispEdges"
    >
      <title id={titleId}>{`Code 128 barcode for ${encoded.value}`}</title>
      <rect x="0" y="0" width={encoded.totalModules} height="40" fill="#ffffff" />
      <path d={barcodePath} fill="#000000" />
    </svg>
  );
}
