// Aggregate parity-results/*.json into a single readable report (console + parity-summary.md).
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "parity-results");
if (!existsSync(DIR)) {
  console.error("No parity-results/ — run `pnpm test` first.");
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const visual = {}; // screen -> { desktop, mobile }
const text = {}; // screen -> missing[]
const admin = {}; // screen -> { desktop, mobile, missing }

for (const f of files) {
  const j = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  if (j.kind === "visual") {
    (visual[j.screen] ??= {})[j.project] = Number(j.pct);
  } else if (j.kind === "text") {
    text[j.screen] = j.missingInScaffold || [];
  } else if (j.kind === "admin") {
    (admin[j.screen] ??= { missing: [] });
    admin[j.screen][j.project] = Number(j.pct);
    if (j.project === "desktop") admin[j.screen].missing = j.missingInScaffold || [];
  }
}

const FLAG = (pct) => (pct == null ? "—" : pct < 2 ? "✅" : pct < 6 ? "⚠️ " : "❌");
const lines = [];
const p = (s) => {
  lines.push(s);
  console.log(s);
};

p("# SparkPoint parity report — scaffold vs approved showcase\n");
p("Visual = % of pixels differing (lower is better; ✅<2% ⚠️<6% ❌≥6%). Text-missing = approved design copy absent from the scaffold.\n");

p("## App screens\n");
p("| Screen | Desktop | Mobile | Text missing |");
p("|---|---|---|---|");
for (const screen of Object.keys(visual).sort()) {
  const d = visual[screen].desktop, m = visual[screen].mobile;
  const miss = (text[screen] || []).length;
  p(`| ${screen} | ${FLAG(d)} ${d ?? "—"}% | ${FLAG(m)} ${m ?? "—"}% | ${miss ? "❌ " + miss + " lines" : "✅ 0"} |`);
}

p("\n## Admin screens\n");
p("| Screen | Desktop | Mobile | Text missing |");
p("|---|---|---|---|");
for (const screen of Object.keys(admin).sort()) {
  const a = admin[screen];
  const miss = (a.missing || []).length;
  p(`| ${screen} | ${FLAG(a.desktop)} ${a.desktop ?? "—"}% | ${FLAG(a.mobile)} ${a.mobile ?? "—"}% | ${miss ? "❌ " + miss + " lines" : "✅ 0"} |`);
}

// Detail: missing copy per screen
const allMissing = [...Object.entries(text), ...Object.entries(admin).map(([k, v]) => [k, v.missing || []])].filter(([, m]) => m && m.length);
if (allMissing.length) {
  p("\n## Missing design copy (per screen)\n");
  for (const [screen, miss] of allMissing) {
    p(`### ${screen}`);
    miss.slice(0, 30).forEach((l) => p(`- ${l}`));
    p("");
  }
}

writeFileSync(join(process.cwd(), "parity-summary.md"), lines.join("\n"));
console.log("\nWrote parity-summary.md");
