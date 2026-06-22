import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tabular number with fixed decimals (en-US) — mirrors the design's `SP.fmt`. */
export function fmt(n: number, d = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** US dollar string — mirrors the design's `SP.money`. */
export function money(n: number, d = 2): string {
  return "$" + fmt(n, d);
}
