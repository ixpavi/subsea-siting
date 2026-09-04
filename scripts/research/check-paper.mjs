// Static checks on docs/paper before it goes near a LaTeX run.
//
// WHY THIS EXISTS. The paper is built from generated tables and generated
// number macros, so the failure mode is not a typo in prose -- it is a macro
// that the generator stopped emitting, a \ref to a label that moved, or a
// figure whose file was renamed. Those all compile to a silent "??" or an
// "Undefined control sequence" hundreds of lines from the cause. This catches
// them in a second without a TeX installation.
//
// It is NOT a LaTeX parser and cannot replace a real compile. It checks the
// four cross-file couplings that this paper's build actually has -- macros,
// labels, citations, included files -- plus environment balance, which is the
// one structural error a generator can introduce.
import { readFileSync, existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAPER = join(__dirname, "..", "..", "docs", "paper");

const problems = [];
const note = (msg) => problems.push(msg);

const main = readFileSync(join(PAPER, "main.tex"), "utf-8");
const numbers = readFileSync(join(PAPER, "numbers.tex"), "utf-8");
const bib = readFileSync(join(PAPER, "refs.bib"), "utf-8");

// Strip comments before scanning: a commented-out \cite is not a citation, and
// this file's own header talks about \input and \ref in prose.
const strip = (s) => s.replace(/(^|[^\\])%.*$/gm, "$1");

// The tables are \input, so their content is part of the document for every
// check below.
const tableFiles = readdirSync(join(PAPER, "tables")).filter((f) => f.endsWith(".tex"));
const tables = Object.fromEntries(
  tableFiles.map((f) => [f, readFileSync(join(PAPER, "tables", f), "utf-8")]),
);
const body = strip(main) + "\n" + Object.values(tables).map(strip).join("\n");

// --- 1. every generated number macro used is defined ------------------------
const defined = new Set([...numbers.matchAll(/\\newcommand\{\\(n[A-Za-z]+)\}/g)].map((m) => m[1]));
const used = new Set([...body.matchAll(/\\(n[A-Z][A-Za-z]*)/g)].map((m) => m[1]));
for (const u of used) {
  if (!defined.has(u)) note(`undefined number macro: \\${u}`);
}
for (const d of defined) {
  if (!used.has(d)) note(`unused number macro (harmless): \\${d}`);
}

// --- 2. every \ref has a \label ---------------------------------------------
const labels = new Set([...body.matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1]));
const refs = new Set(
  [...body.matchAll(/\\(?:eq|page)?ref\{([^}]+)\}/g)].map((m) => m[1]),
);
for (const r of refs) {
  if (!labels.has(r)) note(`\\ref to a missing label: {${r}}`);
}
for (const l of labels) {
  if (!refs.has(l)) note(`label never referenced (harmless): {${l}}`);
}

// --- 3. every \cite key is in the .bib --------------------------------------
const keys = new Set([...bib.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1].trim()));
const cited = new Set(
  [...body.matchAll(/\\cite\{([^}]+)\}/g)].flatMap((m) =>
    m[1].split(",").map((k) => k.trim()),
  ),
);
for (const c of cited) {
  if (!keys.has(c)) note(`\\cite to a key not in refs.bib: ${c}`);
}
for (const k of keys) {
  if (!cited.has(k)) note(`bib entry never cited (will not appear): ${k}`);
}

// --- 4. every \input and \includegraphics resolves ---------------------------
for (const m of strip(main).matchAll(/\\input\{([^}]+)\}/g)) {
  const p = join(PAPER, m[1].endsWith(".tex") ? m[1] : `${m[1]}.tex`);
  if (!existsSync(p)) note(`\\input target missing: ${m[1]}`);
}
for (const m of strip(main).matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
  const p = join(PAPER, "figures", m[1]);
  if (!existsSync(p)) note(`figure missing: figures/${m[1]}`);
}

// --- 5. environments balance ------------------------------------------------
for (const [name, text] of [["main.tex", strip(main)], ...Object.entries(tables).map(
  ([f, t]) => [`tables/${f}`, strip(t)],
)]) {
  const stack = [];
  for (const m of text.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    if (m[1] === "begin") stack.push(m[2]);
    else {
      const top = stack.pop();
      if (top !== m[2]) note(`${name}: \\end{${m[2]}} closes \\begin{${top ?? "nothing"}}`);
    }
  }
  // main.tex legitimately holds `document` open across the \input files.
  const open = stack.filter((s) => s !== "document");
  if (open.length) note(`${name}: unclosed environment(s): ${open.join(", ")}`);
}

// --- 6. table column counts -------------------------------------------------
// A row with the wrong number of & is the classic generated-table bug and LaTeX
// reports it as "Extra alignment tab", far from the row that caused it.
for (const [f, t] of Object.entries(tables)) {
  // The column spec contains braces of its own (@{}, p{...}), so it cannot be
  // captured with [^}]* -- that stops at the first closing brace and reports
  // every table as having zero columns.
  const spec = /\\begin\{tabular\}\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(t);
  if (!spec) continue;
  const declared = (
    spec[1].replace(/@\{[^{}]*\}/g, "").match(/[lcr]|p\{[^{}]*\}/g) ?? []
  ).length;
  const rows = t
    .split("\n")
    .filter((l) => l.includes("&") && l.trim().endsWith("\\\\"))
    .filter((l) => !l.includes("multicolumn"));
  for (const r of rows) {
    const n = (r.match(/(?<!\\)&/g) ?? []).length + 1;
    if (n !== declared) {
      note(`tables/${f}: row has ${n} cells, tabular declares ${declared}: ${r.trim().slice(0, 60)}...`);
    }
  }

}

// --- report -----------------------------------------------------------------
const hard = problems.filter((p) => !p.includes("harmless") && !p.includes("never cited"));
const soft = problems.filter((p) => p.includes("harmless") || p.includes("never cited"));

if (soft.length) {
  console.log("Notes:");
  for (const s of soft) console.log(`  - ${s}`);
  console.log("");
}
if (hard.length) {
  console.log("PROBLEMS:");
  for (const h of hard) console.log(`  ! ${h}`);
  process.exit(1);
}
console.log(
  `OK: ${used.size} macros, ${refs.size} refs, ${cited.size} citations, ` +
    `${tableFiles.length} tables all resolve.`,
);
console.log("This is not a compile. Run pdflatex to catch layout and overfull boxes.");
