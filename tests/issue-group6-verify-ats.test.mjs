// tests/issue-group6-verify-ats.test.mjs — regressions for the ATS scoring /
// parseability audit (issue group 6, items A1–A4, A6, A7).
//
// These pin that structural checks read the SAME non-content-stripped view as
// the text checks (a commented-out <table>/<h2>/<style> is completely inert),
// that custom-property definitions are not mistaken for used fonts, that
// "Core Competencies" is not a Skills heading, that keyword coverage is
// word-boundary aware, and that single-quoted class attributes and the CLI's
// critical-vs-threshold advice behave correctly.
//
// HERMETIC: inline fixtures + tmpdir files only; no user data is read/written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAts } from '../verify-ats.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'verify-ats.mjs');

// A clean, single-column CV that scores 95/A with no issues (same shape the
// existing audit-ats-check-scope.test.mjs fixture uses).
const CLEAN = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>body{font-family:Arial}</style></head><body>
<h1>Jane Doe</h1><p><a href="mailto:jane@example.com">jane@example.com</a> 555-010-0100</p>
<div class="section"><div class="section-title">Work Experience</div><p>Staff Engineer, Acme Corp (2020-present). Built and operated the core payments platform, reducing incident rates and improving deployment cadence across multiple engineering teams.</p></div>
<div class="section"><div class="section-title">Education</div><p>B.S. Computer Science, State University, 2018. Graduated with honors.</p></div>
<div class="section"><div class="section-title">Skills</div><p>Python, Kubernetes, Docker, PostgreSQL, distributed systems, CI/CD pipelines.</p></div>
</body></html>`;

const issueIds = (r) => r.issues.map((i) => i.id);

// ── A1: structural checks must use non-content-stripped HTML/CSS ─────────────

test('A1 a commented-out <table> is inert: no critical layout finding, no score loss', () => {
  const clean = auditAts(CLEAN);
  const commented = auditAts(CLEAN.replace('</body>', '<!-- <table><tr><td>x</td></tr></table> --></body>'));
  assert.equal(commented.score, clean.score);
  assert.ok(!issueIds(commented).includes('layout-tables'));
  assert.equal(commented.issues.length, 0);
});

test('A1 a real <table> is still flagged critical (both directions)', () => {
  const real = auditAts(CLEAN.replace('</body>', '<table><tr><td>x</td></tr></table></body>'));
  assert.ok(issueIds(real).includes('layout-tables'));
  assert.ok(real.issues.some((i) => i.severity === 'critical'));
});

test('A1 a commented-out Skills heading cannot fake a present section', () => {
  const noSkills = CLEAN.replace(
    '<div class="section"><div class="section-title">Skills</div><p>Python, Kubernetes, Docker, PostgreSQL, distributed systems, CI/CD pipelines.</p></div>',
    '<!-- <div class="section"><h2>Skills</h2></div> -->',
  );
  const r = auditAts(noSkills);
  const heading = r.issues.find((i) => i.id === 'section-headings');
  assert.ok(heading, 'missing Skills must be reported');
  assert.match(heading.message, /Skills/);
  // One missing section is a warning (two or more is critical).
  assert.equal(heading.severity, 'warning');
});

test('A1 commented CSS (HTML comment or CSS block comment) yields no bogus font/column/hidden warnings', () => {
  for (const html of [
    CLEAN.replace('</head>', '<!-- <style>body{font-family:"Comic Sans MS";column-count:2;display:none}</style> --></head>'),
    CLEAN.replace('</style>', '/* body{font-family:"Comic Sans MS";column-count:2;display:none} */</style>'),
  ]) {
    const r = auditAts(html);
    for (const id of ['fonts', 'multi-column', 'hidden-text']) {
      assert.ok(!issueIds(r).includes(id), `${id} must not fire on commented CSS`);
    }
    assert.equal(r.score, 95);
  }
});

test('A1 real non-standard font / column-count still flagged', () => {
  const font = auditAts(CLEAN.replace('font-family:Arial', "font-family:'Comic Sans MS'"));
  assert.ok(issueIds(font).includes('fonts'));
  const cols = auditAts(CLEAN.replace('</style>', 'body{column-count:2}</style>'));
  assert.ok(issueIds(cols).includes('multi-column'));
});

// ── A2: custom-property definitions are not used font declarations ──────────

test('A2 the shipped --font-family definition does not drop a clean CV from 95/A', () => {
  const shipped = CLEAN.replace(
    '</head>',
    '<style>:root{--font-family:"Liberation Sans", \'Helvetica Neue\', Arial, \'DejaVu Sans\', \'Arial Unicode MS\', sans-serif;}'
      + 'body{font-family:var(--font-family);}</style></head>',
  );
  const r = auditAts(shipped);
  assert.equal(r.score, 95, 'must not be docked 3 points for a definition, not a use');
  assert.equal(r.grade, 'A');
  assert.ok(!issueIds(r).includes('fonts'));
});

test('A2 arial unicode ms is on the safe-font list when really used', () => {
  const r = auditAts(CLEAN.replace('font-family:Arial', "font-family:'Arial Unicode MS'"));
  assert.ok(!issueIds(r).includes('fonts'));
  assert.equal(r.score, 95);
});

test('A2 a genuinely used non-standard font is still flagged', () => {
  const r = auditAts(CLEAN.replace('font-family:Arial', "font-family:var(--x, 'Comic Sans MS')"));
  assert.ok(issueIds(r).includes('fonts'));
});

// ── A3: "Core Competencies" is not a Skills heading ──────────────────────────

test('A3 a CV with only "Core Competencies" is flagged missing Skills', () => {
  const r = auditAts(
    CLEAN.replace('<div class="section-title">Skills</div>', '<div class="section-title">Core Competencies</div>'),
  );
  const heading = r.issues.find((i) => i.id === 'section-headings');
  assert.ok(heading);
  assert.match(heading.message, /Skills/);
});

test('A3 localized Skills headings still count (competen removed narrowly)', () => {
  for (const heading of ['Competenze', 'Competencias', 'Compétences']) {
    const r = auditAts(CLEAN.replace('<div class="section-title">Skills</div>', `<div class="section-title">${heading}</div>`));
    assert.equal(r.score, 95, `${heading} must still be recognised as Skills`);
    assert.ok(!issueIds(r).includes('section-headings'));
  }
});

// ── A4: keyword coverage is token/boundary aware ─────────────────────────────

test('A4 "go" inside "Django" no longer produces 100% coverage', () => {
  const cv = (text) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h2>Education</h2><p>${text}</p></body></html>`;
  const inside = auditAts(cv('Built Django services'), { keywords: 'go' }).keywordCoverage;
  assert.equal(inside.percent, 0);
  assert.deepEqual(inside.missing, ['go']);
  const whole = auditAts(cv('Built Django services with Go'), { keywords: 'go' }).keywordCoverage;
  assert.equal(whole.percent, 100);
});

test('A4 multi-word phrases must match as consecutive whole words', () => {
  const cv = '<!doctype html><html><head><meta charset="utf-8"></head><body><h2>Education</h2><p>Senior Backend Engineer roles</p></body></html>';
  assert.equal(auditAts(cv, { keywords: 'senior backend engineer' }).keywordCoverage.percent, 100);
  // "senior engineer" is not a contiguous run in "Senior Backend Engineer".
  assert.equal(auditAts(cv, { keywords: 'senior engineer' }).keywordCoverage.percent, 0);
});

test('A4 casing and punctuation differences do not matter, common inflections do', () => {
  const cv = '<!doctype html><html><head><meta charset="utf-8"></head><body><h2>Education</h2><p>We build reliable platforms</p></body></html>';
  assert.equal(auditAts(cv, { keywords: 'BUILD' }).keywordCoverage.percent, 100);
  assert.equal(auditAts(cv, { keywords: 'building' }).keywordCoverage.percent, 100);
});

// ── A6: single-quoted class attributes are supported ─────────────────────────

test('A6 class=\'section-title\' is recognised for all sections', () => {
  const single = CLEAN.replace(/class="section-title"/g, "class='section-title'");
  const r = auditAts(single);
  assert.equal(r.score, 95);
  assert.equal(r.issues.length, 0);
});

// ── A7: CLI advice distinguishes critical issues from the score threshold ────

function runCli(html, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'issue-group6-ats-'));
  try {
    const file = join(dir, 'cv.html');
    writeFileSync(file, html);
    return spawnSync(process.execPath, [SCRIPT, file, ...extraArgs], { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('A7 a critical issue cannot be cleared by --min-score, and the advice says so', () => {
  const critical = CLEAN.replace('</body>', '<table><tr><td>x</td></tr></table></body>');
  const r = runCli(critical, ['--min-score', '0']);
  assert.equal(r.status, 1, 'critical issue must keep exit 1 even with min-score 0');
  assert.match(r.stdout, /critical issue\(s\) above in the document/);
  assert.match(r.stdout, /cannot clear a critical issue/);
});

test('A7 a warning-only failure suggests --min-score and lowering it exits 0', () => {
  const warningOnly = CLEAN.replace('font-family:Arial', "font-family:'Comic Sans MS'");
  const low = runCli(warningOnly, ['--min-score', '0']);
  assert.equal(low.status, 0, 'a non-critical score shortfall is cleared by --min-score');
  // When it passes there is no advice line at all.
  assert.doesNotMatch(low.stdout, /cannot clear a critical issue/);
  const strict = runCli(warningOnly, ['--min-score', '100']);
  assert.equal(strict.status, 1, 'without lowering the bar it still fails');
  assert.match(strict.stdout, /--min-score/);
  assert.doesNotMatch(strict.stdout, /cannot clear a critical issue/);
});
