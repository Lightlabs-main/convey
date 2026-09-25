import type { XStock } from "../lib/xstocks";

/** Generated card art for an xStock: ticker monogram over a gradient field. */
export function XStockArt({ stock, size = 44 }: { stock: XStock; size?: number }) {
  const id = `xs-${stock.ticker}`;
  return (
    <svg className="xstock-art" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={stock.hue[0]} />
          <stop offset="1" stopColor={stock.hue[1]} />
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill={`url(#${id})`} />
      <path d="M0 30 C12 24 20 34 44 20 V44 H0Z" fill="rgba(0,0,0,0.18)" />
      <text x="22" y="27" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0b0b0b" fontFamily="Space Grotesk, sans-serif">
        {stock.ticker.slice(0, 2)}
      </text>
    </svg>
  );
}
