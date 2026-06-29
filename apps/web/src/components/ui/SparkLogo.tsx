"use client";

import { useId } from "react";

/**
 * Sparky brand logo — two overlapping rounded lozenges (orange + blue) with a
 * yellow intersection (the exact overlap, via a clip). Transparent background,
 * so it sits cleanly on dark and light. Shared mark for the whole app.
 */
export function SparkLogo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Sparky"
      xmlns="http://www.w3.org/2000/svg"
    >
      <clipPath id={id} clipPathUnits="userSpaceOnUse">
        <rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(57 60) skewX(-20)" />
      </clipPath>
      <rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(43 40) skewX(-20)" fill="#F47B3F" />
      <rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(57 60) skewX(-20)" fill="#4577E6" />
      <g clipPath={`url(#${id})`}>
        <rect x="-30" y="-17" width="60" height="34" rx="14" transform="translate(43 40) skewX(-20)" fill="#F2C400" />
      </g>
    </svg>
  );
}
