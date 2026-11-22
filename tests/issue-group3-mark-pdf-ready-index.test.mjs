// tests/issue-group3-mark-pdf-ready-index.test.mjs — F10 of the PDF audit.
//
// mark-pdf-ready.mjs used to flip the tracker's PDF cell to ✅ on a report-number
// match alone, with no check that a PDF was actually written and indexed.
// generate-pdf.mjs leaves the output path untouched on a warning-only page
// budget overflow, so the cell could claim a PDF nothing backed. The fix reuses
// sync-pdf-flags.mjs's parsePdfIndex + livePdfIndex check.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nmark-pdf-ready — flip only for a live, indexed PDF (F10)');

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'co-issue-group3-pdfready-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'output'), { recursive: true });
  const tracker = join(dir, 'data', 'applications.md');
  const manifest = join(dir, 'data', 'pdf-index.tsv');
  const lock = join(dir, 'career-ops-merge-tracker-issue-group3.lock');
  writeFileSync(tracker, `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-06-01.md) | keep me |
| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ❌ | [2](../reports/002-globex-2026-06-02.md) | — |
`, 'utf-8');
  return { dir, tracker, manifest, lock };
}

function run(sb, args = ['1']) {
  const env = {
    ...process.env,
    CAREER_OPS_TRACKER: sb.tracker,
    CAREER_OPS_TRACKER_LOCK: sb.lock,
  };
  try {
    const stdout = execFileSync(NODE, [join(ROOT, 'mark-pdf-ready.mjs'), ...args, '--json'], {
      cwd: ROOT, env, encoding: 'utf-8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function lastJson(stdout) {
  // Success prints pretty JSON; failures print a single-line error object.
  return JSON.parse(stdout.trim());
}
function row1(sb) {
  return readFileSync(sb.tracker, 'utf-8').split('\n').find((l) => l.startsWith('| 1 |'));
}
const HEADER = '# report\tpdf\thtml\tformat\tdate\tkind - written by generate-pdf.mjs, do not edit';
const pdf = (sb, name = '001-acme-cv.pdf') => {
  writeFileSync(join(sb.dir, 'output', name), '%PDF-1.4\n%%EOF\n', 'utf-8');
  return `output/${name}`;
};
const manifestRow = (report, relPdf, kind = 'cv') => `${report}\t${relPdf}\toutput/cv.html\ta4\t2026-11-20\t${kind}`;

// ── 1. No manifest at all → fail closed, cell untouched ──
{
  const sb = makeSandbox();
  try {
    const before = row1(sb);
    const r = run(sb);
    const j = lastJson(r.stdout);
    if (r.code === 5 && j?.code === 'pdf-not-ready' && row1(sb) === before) {
      pass('F10: no pdf-index.tsv → exit 5, no flip');
    } else {
      fail(`F10 no manifest: code=${r.code} json=${JSON.stringify(j)}\n${r.stdout}${r.stderr}`);
    }
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
}

// ── 2. Indexed but the PDF file is gone → fail closed ──
{
  const sb = makeSandbox();
  try {
    writeFileSync(sb.manifest, `${HEADER}\n${manifestRow('1', 'output/deleted.pdf')}\n`, 'utf-8');
    const before = row1(sb);
    const r = run(sb);
    const j = lastJson(r.stdout);
    if (r.code === 5 && j?.code === 'pdf-not-ready' && row1(sb) === before) {
      pass('F10: manifest row whose PDF is missing → exit 5, no flip');
    } else {
      fail(`F10 missing artifact: code=${r.code} json=${JSON.stringify(j)}\n${r.stdout}${r.stderr}`);
    }
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
}

// ── 3. Indexed, file on disk → flip only the PDF cell ──
{
  const sb = makeSandbox();
  try {
    const relPdf = pdf(sb);
    writeFileSync(sb.manifest, `${HEADER}\n${manifestRow('1', relPdf)}\n`, 'utf-8');
    const r = run(sb);
    const j = lastJson(r.stdout);
    const after = row1(sb);
    if (r.code === 0 && j?.changed === true && /\| Evaluated \| ✅ \| \[1\]/.test(after)
        && after.includes('| keep me |')) {
      pass('F10: live indexed PDF → flip the PDF cell, all other cells preserved');
    } else {
      fail(`F10 live PDF: code=${r.code} json=${JSON.stringify(j)} row=${after}\n${r.stdout}${r.stderr}`);
    }
    const row2 = readFileSync(sb.tracker, 'utf-8').split('\n').find((l) => l.startsWith('| 2 |'));
    if (/\| ❌ \| \[2\]/.test(row2)) pass('F10: other tracker rows untouched');
    else fail(`F10 other row changed: ${row2}`);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
}

// ── 4. Cover-letter index row is not a CV PDF → fail closed ──
{
  const sb = makeSandbox();
  try {
    const relPdf = pdf(sb, '001-acme-cover.pdf');
    writeFileSync(sb.manifest, `${HEADER}\n${manifestRow('1', relPdf, 'cover')}\n`, 'utf-8');
    const before = row1(sb);
    const r = run(sb);
    if (r.code === 5 && row1(sb) === before) {
      pass('F10: a cover-letter manifest row does not make the CV PDF ready');
    } else {
      fail(`F10 cover row: code=${r.code}\n${r.stdout}${r.stderr}`);
    }
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
}

// ── 5. Already-✅ row stays an idempotent no-op even without a manifest ──
{
  const sb = makeSandbox();
  try {
    const tracker = readFileSync(sb.tracker, 'utf-8').replace(
      '| Evaluated | ❌ | [1]', '| Evaluated | ✅ | [1]');
    writeFileSync(sb.tracker, tracker, 'utf-8');
    const r = run(sb);
    const j = lastJson(r.stdout);
    if (r.code === 0 && j?.changed === false) {
      pass('F10: already-✅ row is still a no-op (no flip to verify)');
    } else {
      fail(`F10 idempotent: code=${r.code} json=${JSON.stringify(j)}\n${r.stdout}${r.stderr}`);
    }
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
}

// ── 6. --dry-run remains a pure preview ──
{
  const sb = makeSandbox();
  try {
    const before = row1(sb);
    const r = run(sb, ['1', '--dry-run']);
    const j = lastJson(r.stdout);
    if (r.code === 0 && j?.dryRun === true && j?.changed === true && row1(sb) === before) {
      pass('F10: --dry-run previews without writing (no flip to verify)');
    } else {
      fail(`F10 dry-run: code=${r.code} json=${JSON.stringify(j)}\n${r.stdout}${r.stderr}`);
    }
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
}
