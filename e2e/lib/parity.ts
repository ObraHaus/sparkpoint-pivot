import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { Theme } from "../screens";

/** Apply the shared `sp-theme` BEFORE any page script runs (no flash, no race). */
export async function primeTheme(page: Page, theme: Theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("sp-theme", t);
    } catch {}
    const h = document.documentElement;
    h.classList.toggle("light", t === "light");
    h.classList.toggle("dark", t !== "light");
  }, theme);
}

/** Kill entrance/looping CSS animation + transitions so screenshots are deterministic. */
export async function freeze(page: Page) {
  await page
    .addStyleTag({
      content: `*,*::before,*::after{animation:none!important;transition:none!important;animation-duration:0s!important;caret-color:transparent!important;}`,
    })
    .catch(() => {});
}

/** Navigate + wait for the screen to settle (network idle + optional timed state changes). */
export async function gotoSettled(page: Page, url: string, settleMs = 700) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(settleMs);
  await freeze(page);
  await page.waitForTimeout(120);
}

/** Normalized visible text (for DOM/content parity), as trimmed non-empty lines. */
export async function visibleText(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => (document.body?.innerText || "").replace(/ /g, " "));
  return raw
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Pad two PNG buffers to a common canvas and pixel-diff them. Returns mismatch ratio + diff PNG. */
export function diffPng(aBuf: Buffer, bBuf: Buffer): { width: number; height: number; mismatch: number; ratio: number; diff: Buffer } {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  const W = Math.max(a.width, b.width);
  const H = Math.max(a.height, b.height);
  const pad = (src: PNG) => {
    if (src.width === W && src.height === H) return src;
    const dst = new PNG({ width: W, height: H });
    // fill with opaque magenta so out-of-bounds (length mismatch) is visible + counted
    for (let i = 0; i < dst.data.length; i += 4) {
      dst.data[i] = 255;
      dst.data[i + 1] = 0;
      dst.data[i + 2] = 255;
      dst.data[i + 3] = 255;
    }
    PNG.bitblt(src, dst, 0, 0, src.width, src.height, 0, 0);
    return dst;
  };
  const pa = pad(a);
  const pb = pad(b);
  const diff = new PNG({ width: W, height: H });
  const mismatch = pixelmatch(pa.data, pb.data, diff.data, W, H, { threshold: 0.12, includeAA: false });
  return { width: W, height: H, mismatch, ratio: mismatch / (W * H), diff: PNG.sync.write(diff) };
}

/** Diff two ordered text-line arrays into added/removed (showcase vs scaffold). */
export function textDelta(showcase: string[], scaffold: string[]): { missingInScaffold: string[]; extraInScaffold: string[] } {
  const sc = new Set(scaffold.map((s) => s.toLowerCase()));
  const sh = new Set(showcase.map((s) => s.toLowerCase()));
  return {
    missingInScaffold: showcase.filter((l) => !sc.has(l.toLowerCase())),
    extraInScaffold: scaffold.filter((l) => !sh.has(l.toLowerCase())),
  };
}
