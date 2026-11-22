// tests/issue-group3-pdf-gate-sources.test.mjs — F5 + F11 of the PDF audit.
//
// F5: the voice (banned/advisory phrase) check used to read only cv.md, while
//     assertFacts read every CV source. A phrase legitimately present in
//     cvs/master.md blocked the render with a "banned phrase" error.
// F11: the "hard gate before PDF" was decided on cv.md alone, so a workspace
//     with only cvs/master.md silently skipped the gate (renderer only warned).
//
// Both are rendered end-to-end through a copy of generate-pdf.mjs with a stub
// Chromium, the same sandbox pattern as generate-pdf-fact-gate-workspace.test.mjs.
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync as fsRmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, linkRepoPackage, ROOT, NODE, SANDBOX_DATA_ROOT } from './helpers.mjs';

const OUTPUT_ROOT = join(SANDBOX_DATA_ROOT, 'output');
mkdirSync(OUTPUT_ROOT, { recursive: true });

const CORE_FILES = [
  'generate-pdf.mjs', 'verify-cv-facts.mjs', 'cv-voice.mjs', 'theme-style.mjs', 'cv-experience-order.mjs',
  'tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs',
  'cv-sections-core.mjs', 'path-resolver.mjs',
];
const LIB_FILES = [
  'is-main-module.mjs', 'page-format.mjs', 'browser-launch.mjs', 'dir-lock.mjs', 'yaml-document.mjs',
  'local-today.mjs', 'cv-markdown.mjs', 'cv-sources.mjs', 'walk-tree.mjs', 'scratch-dirs.mjs',
];
const PLAYWRIGHT_STUB = `
const PDF = Buffer.from('%PDF-1.7\\n1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n2 0 obj\\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\\nendobj\\n3 0 obj\\n<< /Type /Page /Parent 2 0 R >>\\nendobj\\n%%EOF', 'latin1');
const page = () => ({ async goto() {}, async evaluate() {}, async pdf() { return PDF; }, async close() {} });
export const chromium = {
  async launch() {
    return {
      async newContext() { return { async newPage() { return page(); }, async close() {} }; },
      async newPage() { return page(); },
      async close() {},
    };
  },
};
`;

function makeWorkspace(label) {
  const base = realpathSync(mkdtempSync(join(OUTPUT_ROOT, `issue-group3-${label}-`)));
  const code = join(base, 'code');
  const workspace = join(base, 'ws');
  mkdirSync(join(code, 'lib'), { recursive: true });
  mkdirSync(join(workspace, 'data'), { recursive: true });
  mkdirSync(join(workspace, 'output'), { recursive: true });
  for (const f of CORE_FILES) copyFileSync(join(ROOT, f), join(code, f));
  for (const f of LIB_FILES) copyFileSync(join(ROOT, 'lib', f), join(code, 'lib', f));
  linkRepoPackage(code, 'js-yaml');
  const playwrightStub = join(code, 'node_modules', 'playwright');
  mkdirSync(playwrightStub, { recursive: true });
  writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({ name: 'playwright', type: 'module', exports: './index.js' }), 'utf-8');
  writeFileSync(join(playwrightStub, 'index.js'), PLAYWRIGHT_STUB, 'utf-8');
  writeFileSync(join(workspace, 'data', 'applications.md'),
    '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n', 'utf-8');
  writeFileSync(join(workspace, 'data', 'pdf-index.tsv'), '', 'utf-8');
  return { base, code, workspace };
}

function render(ws, name, body) {
  const input = join(ws.workspace, name);
  const output = join(ws.workspace, 'output', name.replace(/\.html$/, '.pdf'));
  fsRmSync(output, { force: true });
  writeFileSync(input, `<!doctype html>\n<html>\n<body>\n<main><h1>Jordan Example</h1><p>${body}</p></main>\n</body>\n</html>\n`, 'utf-8');
  const result = spawnSync(NODE, [join(ws.code, 'generate-pdf.mjs'), input, output], {
    cwd: ws.code,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: ws.code,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: join(ws.workspace, 'data', 'applications.md'),
    },
  });
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}`, rendered: existsSync(output) };
}

console.log('\ngenerate-pdf — voice check and gate decision use every CV source (F5/F11)');

// ── F5: a banned phrase present in cvs/master.md is the candidate's own words ──
try {
  const ws = makeWorkspace('f5');
  try {
    writeFileSync(join(ws.workspace, 'cv.md'), '# Jordan Example\n\n- Built internal tooling.\n', 'utf-8');
    const extra = join(ws.workspace, 'cvs');
    mkdirSync(extra, { recursive: true });
    writeFileSync(join(extra, 'master.md'), '# Jordan Example — master\n\n- Known for a proven track record in platform work.\n', 'utf-8');
    // The whole line is new, but the phrase itself is in cvs/master.md.
    const body = 'A proven track record in platform work is what I bring.';
    const ok = render(ws, 'own-words.html', body);
    if (ok.status === 0 && ok.rendered && /Fact check passed: own-words\.html/.test(ok.output)) {
      pass('F5: a banned phrase present in cvs/master.md does not block the render');
    } else {
      fail(`F5 truthful phrase: status=${ok.status} rendered=${ok.rendered}\n${ok.output.trim()}`);
    }

    // Not weakened: with the phrase genuinely absent from EVERY source it blocks.
    writeFileSync(join(extra, 'master.md'), '# Jordan Example — master\n\n- Worked on platform tooling.\n', 'utf-8');
    const blocked = render(ws, 'invented-words.html', body);
    if (blocked.status !== 0 && !blocked.rendered && /Voice check failed/.test(blocked.output) && /proven track record/.test(blocked.output)) {
      pass('F5: the same phrase still blocks when no CV source carries it');
    } else {
      fail(`F5 absent phrase: status=${blocked.status} rendered=${blocked.rendered}\n${blocked.output.trim()}`);
    }
  } finally {
    fsRmSync(ws.base, { recursive: true, force: true });
  }
} catch (err) {
  fail(`F5 setup threw: ${err.stack || err}`);
}

// ── F11: cvs/* only — the gate must run, not silently warn ──
try {
  const ws = makeWorkspace('f11');
  try {
    const extra = join(ws.workspace, 'cvs');
    mkdirSync(extra, { recursive: true });
    writeFileSync(join(extra, 'master.md'), '# Jordan Example — master\n\n- Led a team of 4 engineers.\n', 'utf-8');
    // No cv.md anywhere. assertFacts reads cvs/master.md, so "40" is invented.
    const honest = render(ws, 'honest.html', 'Led a team of 4 engineers.');
    if (honest.status === 0 && honest.rendered && /Fact check passed: honest\.html/.test(honest.output)) {
      pass('F11: a cvs/*-only workspace runs the gate and passes a truthful CV');
    } else {
      fail(`F11 truthful: status=${honest.status} rendered=${honest.rendered}\n${honest.output.trim()}`);
    }
    const inflated = render(ws, 'inflated.html', 'Led a team of 40 engineers.');
    if (inflated.status !== 0 && !inflated.rendered && /Fact check failed for inflated\.html/.test(inflated.output)) {
      pass('F11: a cvs/*-only workspace blocks a claim absent from those CVs');
    } else {
      fail(`F11 inflated: status=${inflated.status} rendered=${inflated.rendered}\n${inflated.output.trim()}`);
    }

    // Genuinely no sources: warn-not-block, and an accurate "did not run" line.
    fsRmSync(join(extra, 'master.md'), { force: true });
    const unchecked = render(ws, 'unchecked.html', 'Led a team of 4 engineers.');
    if (unchecked.status === 0 && unchecked.rendered
        && /Fact check did not run: no cv\.md at /.test(unchecked.output)
        && /no other CV sources/.test(unchecked.output)
        && !/Fact check passed/.test(unchecked.output)) {
      pass('F11: with no CV sources at all the render warns it was not checked, without blocking');
    } else {
      fail(`F11 no sources: status=${unchecked.status} rendered=${unchecked.rendered}\n${unchecked.output.trim()}`);
    }
  } finally {
    fsRmSync(ws.base, { recursive: true, force: true });
  }
} catch (err) {
  fail(`F11 setup threw: ${err.stack || err}`);
}
