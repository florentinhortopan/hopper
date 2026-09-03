"use client";

import {
  BRAND_CREDIT,
  BRAND_NAME,
  BRAND_SUBLINE,
} from "@attatta/shared";

type Props = {
  /** display = hero wordmark; nav = sidebar; compact = live header */
  size?: "display" | "nav" | "compact";
  /** Show Paul IP subline when space allows */
  showSubline?: boolean;
  className?: string;
  href?: string;
};

/**
 * Product wordmark. Keep technical IDs as attatta; only the face of the product is SCOTTY.
 */
export function BrandMark({
  size = "nav",
  showSubline = true,
  className = "",
  href,
}: Props) {
  const titleClass =
    size === "display"
      ? "font-display text-4xl tracking-tight text-ink-900"
      : size === "compact"
        ? "font-display text-xl font-semibold tracking-tight text-ink-900"
        : "font-display text-3xl tracking-tight text-ink-900";

  const sub =
    size === "compact"
      ? BRAND_CREDIT
      : size === "display"
        ? BRAND_SUBLINE
        : BRAND_SUBLINE;

  const subClass =
    size === "compact"
      ? "text-[9px] uppercase tracking-[0.14em] text-ink-600"
      : "mt-1 text-[11px] uppercase tracking-[0.18em] text-ink-700";

  const inner = (
    <>
      <div className={titleClass}>{BRAND_NAME}</div>
      {showSubline ? <p className={subClass}>{sub}</p> : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={`block no-underline transition-colors hover:text-ember-600 ${className}`}
        title={`${BRAND_NAME} — ${BRAND_SUBLINE}`}
      >
        {inner}
      </a>
    );
  }

  return <div className={className}>{inner}</div>;
}
