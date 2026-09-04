// Convert the generated figures to PDF for LaTeX submission.
//
// WHY A BROWSER. IEEE wants vector line art, and pdflatex cannot read SVG. The
// usual answers -- Inkscape, rsvg-convert, cairosvg -- are all installs. Chrome
// and Edge ship with the OS and both render SVG to a real vector PDF, so this
// adds no dependency to a study whose stated property is "no prerequisite
// beyond Node". Text stays selectable text and curves stay curves; nothing here
// rasterises.
//
// THE PAGE BOX IS THE FIGURE BOX. Printing a page normally gives Letter or A4
// with margins, which would pad every figure with whitespace and defeat the
// 252 pt column sizing. The wrapper below sets `@page { size: <w>pt <h>pt;
// margin: 0 }` to the SVG's own intrinsic dimensions, so the PDF's MediaBox is
// exactly the figure and \includegraphics[width=\columnwidth] lands at 1:1 --
// which is the whole reason the figures were drawn at 252 pt in the first
// place. Scaling them would scale the 7-8 pt type with them.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join, basename } from "path";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..", "docs", "figures");
const OUT = join(__dirname, "..", "..", "docs", "paper", "figures");

/** Chrome and Edge are the same engine here; take whichever the machine has. */
function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    "No Chrome or Edge found. Set CHROME_PATH, or convert docs/figures/*.svg\n" +
      "with any SVG->PDF tool; the figures are plain SVG with no external assets.",
  );
}

/** The SVG's own width/height attributes are the page size. They are in pt. */
function intrinsicSize(svg) {
  const w = /\bwidth="([\d.]+)"/.exec(svg);
  const h = /\bheight="([\d.]+)"/.exec(svg);
  if (!w || !h) throw new Error("figure has no intrinsic width/height");
  return { w: Number(w[1]), h: Number(h[1]) };
}

const browser = findBrowser();
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// One throwaway profile, so this never touches the user's real browser state
// and never prompts about a running instance.
const profile = join(tmpdir(), `fig-pdf-${process.pid}`);

const files = readdirSync(SRC).filter((f) => f.endsWith(".svg")).sort();
if (files.length === 0) {
  console.error(`No SVGs in ${SRC}. Run make-figures.mjs first.`);
  process.exit(1);
}

console.log(`Rendering with ${basename(browser)}\n`);
for (const file of files) {
  const svg = readFileSync(join(SRC, file), "utf-8");
  const { w, h } = intrinsicSize(svg);

  // The SVG is inlined rather than referenced, so the print has no subresource
  // to fetch and cannot race the page load.
  // An explicit <title> becomes the PDF's /Title. Without one Chrome uses the
  // source filename, which carries this process's pid and would make the
  // output differ on every run.
  const html = `<!doctype html><meta charset="utf-8">
<title>${basename(file, ".svg")}</title>
<style>
  @page { size: ${w}pt ${h}pt; margin: 0; }
  html, body { margin: 0; padding: 0; }
  svg { display: block; }
</style>
${svg}`;

  const htmlPath = join(tmpdir(), `${basename(file, ".svg")}-${process.pid}.html`);
  const pdfPath = join(OUT, `${basename(file, ".svg")}.pdf`);
  writeFileSync(htmlPath, html, "utf-8");

  execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--no-pdf-header-footer",
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  rmSync(htmlPath, { force: true });
  if (!existsSync(pdfPath)) throw new Error(`${file}: browser produced no PDF`);

  // Chrome stamps the wall clock into /CreationDate and /ModDate, so an
  // unchanged figure produces a different file on every run and every rebuild
  // dirties the working tree. Pin both to the epoch: the figures are committed
  // (Overleaf needs them), and a diff should mean the data moved, not that
  // someone ran the build. Same byte length, so no offset in the xref table.
  const buf = readFileSync(pdfPath);
  const EPOCH = "D:19700101000000+00'00'";
  let n = 0;
  for (const key of ["CreationDate", "ModDate"]) {
    const at = buf.indexOf(`/${key} (D:`);
    if (at === -1) continue;
    const open = buf.indexOf("(", at);
    const close = buf.indexOf(")", open);
    if (close - open - 1 !== EPOCH.length) continue; // unexpected format, leave it
    buf.write(EPOCH, open + 1, "latin1");
    n += 1;
  }
  if (n) writeFileSync(pdfPath, buf);

  const kb = (buf.length / 1024).toFixed(1);
  console.log(`  ${basename(file, ".svg")}.pdf   ${w}x${h} pt   ${kb} kB`);
}

rmSync(profile, { recursive: true, force: true });
console.log(`\n${files.length} figures -> docs/paper/figures/`);
