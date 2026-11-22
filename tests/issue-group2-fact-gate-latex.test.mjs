// issue-group2 — fact-gate and LaTeX mechanics regressions (F1, F2, F3, F4,
// F6, F7, F8, F9, F13, P4, P12, P13, P14, L1). Owned by this workstream only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyFacts, sourceContradictions, percentageClaimsWithContext, latexProjectHeadingClaims } from '../verify-cv-facts.mjs';
import { boldLineText, boldTitleWithDates } from '../lib/cv-markdown.mjs';
import { parseCvExperience, checkTitles, parseTailoredExperience } from '../cv-title-check.mjs';
import { findMatchingBrace, createSecureTempFile, validateLatexLockedSections, latexSectionKey } from '../lib/latex-content.mjs';
import { runLatexFactGate, parseLatexArgs, isHeadlessFactGate, warnFactGateNotRunLatex } from '../generate-latex.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const script = name => join(ROOT, name);
function root(t) {
  const dir = mkdtempSync(join(tmpdir(), 'issue-group2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(rootDir, rel, content) {
  const path = join(rootDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}
const opts = (dir, extra = {}) => ({
  sourcePaths: [join(dir, 'cv.md')], configPath: join(dir, 'config', 'cv-facts.json'), ...extra,
});
function spawnBuilder(dir, input, output, extraEnv = {}) {
  return spawnSync(process.execPath, [script('build-cv-latex.mjs'), input, output], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '', ...extraEnv },
  });
}
const CV = `# Jane Doe

## Experience

### Acme Corp — Remote
**Senior Software Engineer**
2019 – 2024
- Led a team of 4 engineers.

## Education
BS Computer Science, State University (2015)
MS Data Science, Tech Institute (2017)

## Projects
- Real Project

## Awards
- Real Award

## Skills
- Python, Go
`;
const payload = over => ({
  name: 'Jane Doe', contact_line: 'Remote',
  experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2019 – 2024', bullets: ['Led a team of 4 engineers.'] }],
  education: [{ institution: 'State University', degree: 'BS Computer Science', dates: '2015' }],
  projects: [{ name: 'Real Project', dates: '2024', bullets: [] }],
  awards: [{ title: 'Real Award', year: '2024' }],
  skills: [{ category: 'Languages', items: 'Python, Go' }],
  ...over,
});

// ── F1 ────────────────────────────────────────────────────────────────
test('F1: a non-flat additional CV does not disable education blocks', t => {
  const dir = root(t);
  write(dir, 'cv.md', CV);
  // An education section in a shape the old flat-only parser could not read.
  write(dir, 'cvs/extra.md', '# Other\n\n## Education\n\nEducation from several institutions over time\n');
  write(dir, 'config/cv-facts.json', '{}');
  const sources = [join(dir, 'cv.md'), join(dir, 'cvs/extra.md')];
  const pair = `<div class="edu-item"><div class="edu-title">BS Computer Science</div><div class="edu-org">Tech Institute</div><div class="edu-year">2015</div></div>`;
  const association = verifyFacts(pair, opts(dir, { sourcePaths: sources }));
  assert.equal(association.verdict, 'block');
  assert.ok(association.unsupportedFacts.some(f => f.kind === 'education-association'), JSON.stringify(association));

  const year = `<div class="edu-item"><div class="edu-title">BS Computer Science</div><div class="edu-org">State University</div><div class="edu-year">2011</div></div>`;
  const graduation = verifyFacts(year, opts(dir, { sourcePaths: sources }));
  assert.equal(graduation.verdict, 'block');
  assert.ok(graduation.unsupportedFacts.some(f => f.kind === 'graduation-date'), JSON.stringify(graduation));
});

test('F1: multi-language and **Degree** — School formats are parsed', t => {
  const dir = root(t);
  const fr = write(dir, 'cvs/fr.md', `# Autre\n\n## Formation\n\n- Diplôme d'ingénieur, INSAT (2022)\n`);
  const en = write(dir, 'cvs/en.md', `# Other\n\n## Education\n\n* **Software Engineering Degree** — National Institute of Applied Sciences and Technology (INSAT)\n  *Tunis, Tunisia | Sep 2022 – Present*\n`);
  const target = `<div class="edu-item"><div class="edu-title">Software Engineering Degree</div><div class="edu-org">National Institute of Applied Sciences and Technology (INSAT)</div><div class="edu-year">2022</div></div>`;
  const result = verifyFacts(target, opts(dir, { sourcePaths: [en, fr] }));
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
});

// ── F2 ────────────────────────────────────────────────────────────────
test('F2: a percentage needs its own context, not just its number', t => {
  const dir = root(t);
  write(dir, 'cv.md', '# CV\n\n- Improved model accuracy 90%.\n');
  write(dir, 'config/cv-facts.json', '{}');
  const truthful = verifyFacts('Improved model accuracy 90%.', opts(dir));
  assert.equal(truthful.verdict, 'pass', JSON.stringify(truthful));
  const invented = verifyFacts('Reduced customer churn 90%.', opts(dir));
  assert.equal(invented.verdict, 'block', JSON.stringify(invented));
  assert.ok(invented.unsupportedFacts.some(f => f.kind === 'percentage-context'));
});

test('F2: percentage context is read from markdown, not only structured HTML', () => {
  assert.deepEqual(percentageClaimsWithContext('Improved model accuracy 90%.'), [
    { metric: '90%', context: ['improved', 'model', 'accuracy'] },
  ]);
});

test('F2: undeterminable context is an explicit advisory, not a silent pass', t => {
  const dir = root(t);
  write(dir, 'cv.md', '# CV\n\n- A figure reached 90%.\n- Accuracy was 90%.\n');
  write(dir, 'config/cv-facts.json', '{}');
  const result = verifyFacts('It was 90%.', opts(dir));
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.ok(result.advisoryFacts.some(f => f.kind === 'percentage-context-unverified'));
});

// ── F3 / F7 ───────────────────────────────────────────────────────────
test('F3: an invented project name blocks the build gate before any .tex', t => {
  const dir = root(t);
  write(dir, 'cv.md', CV);
  write(dir, 'config/cv-facts.json', '{}');
  const input = write(dir, 'input.json', JSON.stringify(payload({ projects: [{ name: 'Invented Project', dates: '2024', bullets: [] }] })));
  const output = join(dir, 'cv.tex');
  const run = spawnBuilder(dir, input, output);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).factCheck.verdict, 'block');
  assert.match(JSON.parse(run.stdout).factCheck.reason, /project/);
  assert.equal(existsSync(output), false);
});

test('F3: raw \\resumeProjectHeading names are project claims', () => {
  const claims = latexProjectHeadingClaims(String.raw`\begin{document}
\resumeProjectHeading{\href{https://example.com}{\textbf{Invented Project}} \emph{$|$ Python}}{2024}
\resumeProjectHeading{\textbf{Invented Award} \emph{$|$ IOI}}{2023}
\end{document}`);
  assert.deepEqual(claims.map(c => c.value), ['invented project', 'invented award']);
});

test('F7: the build gate runs when only cvs/* exists (no cv.md)', t => {
  const dir = root(t);
  // No cv.md — only an additional CV. The old probe skipped the gate entirely.
  write(dir, 'cvs/other.md', '# Other\n\n## Experience\n\n### Acme Corp — Remote\n**Senior Software Engineer**\n2019 – 2024\n\n## Projects\n- Real Project\n\n## Awards\n- Real Award\n');
  write(dir, 'config/cv-facts.json', '{}');
  const input = write(dir, 'input.json', JSON.stringify(payload({ awards: [{ title: 'Invented Award', year: '2024' }] })));
  const output = join(dir, 'cv.tex');
  const run = spawnBuilder(dir, input, output);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.factCheck.verdict, 'block');
  assert.match(report.factCheck.reason, /award=invented award/);
});

// ── F4 ────────────────────────────────────────────────────────────────
test('F4: partly-bold title + inline date range parses and reports a mismatch', () => {
  const cv = '## Experience\n\n### Acme Corp — Remote\n\n**Senior Software Engineer** · Feb 2023 – present\n';
  // boldLineText() stays strict for partly-bold lines (#4879) — callers try
  // boldTitleWithDates() FIRST for the `**Title** · dates` shape.
  assert.equal(boldLineText('**Engineering Lead** · Feb 2023 – present'), null);
  assert.deepEqual(boldTitleWithDates('**Engineering Lead** · Feb 2023 – present'), {
    title: 'Engineering Lead', dates: 'Feb 2023 – present',
  });
  const entries = parseCvExperience(cv);
  assert.equal(entries.length, 1);
  const result = checkTitles(entries, parseTailoredExperience({
    experience: [{ company: 'Acme Corp', role: 'Engineering Lead', dates: 'Feb 2023 - present' }],
  }));
  assert.deepEqual(result.mismatches.map(m => m.tailoredTitle), ['Engineering Lead']);
});

// ── F6 ────────────────────────────────────────────────────────────────
test('F6: conflicting handles/titles across CVs are reported with provenance', t => {
  const dir = root(t);
  write(dir, 'cv.md', '# Me\n\nGitHub: github.com/AlphaHandle\n\nLinkedIn: linkedin.com/in/alpha\n\n## Experience\n\n### SpecTraceAi — Remote\n**Full Stack Developer**\n2024\n');
  write(dir, 'cvs/other.md', '# Me\n\nGitHub: github.com/BetaHandle\n\nLinkedIn: linkedin.com/in/beta\n\n## Experience\n\n### SpecTraceAi — Remote\n**Full-Stack Engineer**\n2024\n');
  write(dir, 'config/cv-facts.json', '{}');
  const findings = sourceContradictions([
    { path: join(dir, 'cv.md'), text: readFileSync(join(dir, 'cv.md'), 'utf-8') },
    { path: join(dir, 'cvs/other.md'), text: readFileSync(join(dir, 'cvs/other.md'), 'utf-8') },
  ]);
  const github = findings.find(f => f.field === 'github');
  assert.ok(github, JSON.stringify(findings));
  assert.equal(github.values.length, 2);
  assert.ok(github.values.every(v => v.sources.length === 1));
  assert.equal(github.preferred, github.values[0].value); // precedence reported, not applied
  assert.ok(findings.some(f => f.field === 'job-title' && f.key === 'spectraceai'));
  const result = verifyFacts('A truthful line.', opts(dir, { sourcePaths: [join(dir, 'cv.md'), join(dir, 'cvs/other.md')] }));
  assert.ok(result.warnings.some(w => w.includes('Conflicting values across CV sources')), JSON.stringify(result.warnings));
});

// ── F13 ───────────────────────────────────────────────────────────────
test('F13: a profile notice period is trusted evidence, never invented', t => {
  const dir = root(t);
  write(dir, 'cv.md', '# CV\n\n## Skills\n- Python\n');
  write(dir, 'config/cv-facts.json', '{}');
  const profile = write(dir, 'config/profile.yml', 'cover_letter:\n  notice_period_days: 30\n');
  const result = verifyFacts('I have a 30-day notice period.', opts(dir, { profilePath: profile }));
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
  assert.deepEqual(result.invented, []);
});

// ── P4 ────────────────────────────────────────────────────────────────
test('P4: an unsupported skill is an explicit advisory, not silent', t => {
  const dir = root(t);
  write(dir, 'cv.md', CV);
  write(dir, 'config/cv-facts.json', '{}');
  const result = verifyFacts('<div class="skill-item">Kubernetes</div>', opts(dir));
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.ok(result.advisoryFacts.some(f => f.kind === 'skill' && f.value === 'kubernetes'));
});

// ── F8 / F9 ───────────────────────────────────────────────────────────
test('F8: --source cannot point at the generated .tex or output/', async t => {
  const dir = root(t);
  write(dir, 'cv.md', CV);
  write(dir, 'config/cv-facts.json', '{}');
  const tex = write(dir, 'output/cv.tex', '\\begin{document}Clams\\end{document}');
  const self = await runLatexFactGate('\\begin{document}Clams\\end{document}', {
    root: dir, extraSources: [tex], inputPath: tex, label: 'cv.tex',
  });
  assert.equal(self.verdict, 'block');
  assert.match(self.reason, /generated document|output\//);
  const other = write(dir, 'output/cv2.tex', '\\begin{document}Clams\\end{document}');
  const outputPath = await runLatexFactGate('\\begin{document}Clams\\end{document}', {
    root: dir, extraSources: [other], inputPath: join(dir, 'cv.tex'), label: 'cv.tex',
  });
  assert.equal(outputPath.verdict, 'block');
});

test('F9: an unreadable/non-file --source returns a block verdict, never a stack trace', async t => {
  const dir = root(t);
  write(dir, 'cv.md', CV);
  write(dir, 'config/cv-facts.json', '{}');
  mkdirSync(join(dir, 'a-directory'));
  const result = await runLatexFactGate('\\begin{document}Clams\\end{document}', {
    root: dir, extraSources: [join(dir, 'a-directory')], label: 'cv.tex',
  });
  assert.equal(result.verdict, 'block');
  assert.match(result.reason, /not a regular file|not found/);
});

// ── P12 ───────────────────────────────────────────────────────────────
test('P12: flag parsing and headless refusal for --skip-fact-check', async t => {
  assert.equal(parseLatexArgs(['a.tex', '--strict-fact-check']).strictFactCheck, true);
  assert.equal(parseLatexArgs(['a.tex', '--skip-fact-check']).skipFactCheck, true);
  assert.ok(isHeadlessFactGate({ CI: 'true' }, { stdin: { isTTY: true }, stdout: { isTTY: true } }));
  assert.equal(isHeadlessFactGate({}, { stdin: { isTTY: true }, stdout: { isTTY: true } }), false);
  const lines = [];
  warnFactGateNotRunLatex(line => lines.push(line));
  assert.match(lines[0], /FACT CHECK SKIPPED/);

  const dir = root(t);
  write(dir, 'cv.tex', '\\begin{document}\n\\end{document}');
  const run = spawnSync(process.execPath, [script('generate-latex.mjs'), 'cv.tex', 'out.pdf', '--skip-fact-check'], {
    cwd: dir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir, CI: 'true' },
  });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /Refusing --skip-fact-check/);

  const both = spawnSync(process.execPath, [script('generate-latex.mjs'), 'cv.tex', 'out.pdf', '--skip-fact-check', '--strict-fact-check'], {
    cwd: dir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir, CI: '' },
  });
  assert.equal(both.status, 1, both.stdout + both.stderr);
  assert.match(both.stderr, /cannot be combined/);

  // A `warn` verdict is fatal under --strict-fact-check (mirrors generate-pdf).
  const warnDir = root(t);
  write(warnDir, 'cv.md', '# Me\n\nGitHub: github.com/AlphaHandle\n\n## Skills\n- Python\n');
  write(warnDir, 'cvs/other.md', '# Me\n\nGitHub: github.com/BetaHandle\n');
  write(warnDir, 'config/cv-facts.json', '{}');
  write(warnDir, 'cv.tex', '\\begin{document}\n\\section{Skills}\nPython\n\\end{document}');
  const strict = spawnSync(process.execPath, [script('generate-latex.mjs'), 'cv.tex', 'out.pdf', '--strict-fact-check'], {
    cwd: warnDir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: warnDir, CAREER_OPS_PROFILE: '' },
  });
  assert.equal(strict.status, 1, strict.stdout + strict.stderr);
  assert.match(strict.stderr, /--strict-fact-check: a warning is fatal/);
});

// ── P13 ───────────────────────────────────────────────────────────────
test('P13: locked sections are validated verbatim on the LaTeX path', t => {
  const cv = '## Summary\n\nOriginal summary sentence.\n\n## Experience\n\n- Work.\n';
  const tex = '\\section{Summary}\nOriginal summary sentence.\n\\section{Experience}\n\\resumeItem{Work.}\n';
  assert.doesNotThrow(() => validateLatexLockedSections(tex, cv, ['summary']));
  assert.throws(() => validateLatexLockedSections(tex.replace('Original summary sentence.', 'A totally rewritten summary.'), cv, ['summary']),
    /Locked section 'summary' was modified/);
  assert.equal(latexSectionKey('Professional Experience'), 'experience');
});

test('P13: build-cv-latex blocks a locked section reordered in the payload', t => {
  const dir = root(t);
  const cv = `# Jane Doe

## Experience

### Acme Corp — Remote
**Senior Software Engineer**
2019 – 2024
- Led a team of 4 engineers.
- Owned the platform.
`;
  write(dir, 'cv.md', cv);
  write(dir, 'config/cv-facts.json', '{}');
  write(dir, 'config/profile.yml', 'cv:\n  locked_sections:\n    - Experience\n');
  const base = {
    name: 'Jane Doe', contact_line: 'Remote',
    experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2019 – 2024', location: 'Remote',
      bullets: ['Led a team of 4 engineers.', 'Owned the platform.'] }],
    education: [], projects: [], awards: [], skills: [],
  };
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: join(dir, 'config/profile.yml') };
  const unchangedInput = write(dir, 'unchanged.json', JSON.stringify(base));
  const ok = spawnSync(process.execPath, [script('build-cv-latex.mjs'), unchangedInput, join(dir, 'ok.tex')], { encoding: 'utf-8', env });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);

  // Same facts, reordered: the fact gate still passes, but the locked section
  // guard must refuse the reordered body before the .tex reaches disk.
  const reordered = write(dir, 'reordered.json', JSON.stringify({
    ...base,
    experience: [{ ...base.experience[0], bullets: ['Owned the platform.', 'Led a team of 4 engineers.'] }],
  }));
  const output = join(dir, 'cv.tex');
  const run = spawnSync(process.execPath, [script('build-cv-latex.mjs'), reordered, output], { encoding: 'utf-8', env });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.factCheck.verdict, 'block');
  assert.match(report.factCheck.reason, /Locked section 'experience'/);
  assert.equal(existsSync(output), false);
});

// ── P14 ───────────────────────────────────────────────────────────────
test('P14: secure temp files use a random 0600 file in a 0700 dir', t => {
  const secure = createSecureTempFile({ contents: 'secret CV data' });
  t.after(secure.cleanup);
  assert.equal(readFileSync(secure.path, 'utf-8'), 'secret CV data');
  assert.equal(statSync(secure.path).mode & 0o777, 0o600);
  assert.equal(statSync(secure.dir).mode & 0o777, 0o700);
  assert.equal(dirname(secure.path), secure.dir);
  assert.equal(/^career-ops-/.test(secure.dir.split('/').pop()), true);
});

// ── L1 ────────────────────────────────────────────────────────────────
test('L1: a brace inside a LaTeX % comment does not close a slot', () => {
  const tex = String.raw`\resumeItem{Built \textbf{Thing} % a stray } in a comment
more text}`;
  assert.equal(findMatchingBrace(tex, tex.indexOf('{')), tex.lastIndexOf('}'));
  const escaped = String.raw`\resumeItem{50\% done with the work}`;
  assert.equal(findMatchingBrace(escaped, escaped.indexOf('{')), escaped.lastIndexOf('}'));
});
