// tests/issue-group5-cv-headings.test.mjs — S3: classifyHeading must recognise
// qualified and non-English section headings, so facts unique to the repo's
// additional CVs are not silently dropped on import. Also checks that prose
// under an unrecognised `##` heading is not absorbed into the prior section.
//
// Run: node --test tests/issue-group5-cv-headings.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'career-profile.mjs');

function preview(root, source) {
  const result = spawnSync(process.execPath, [CLI, 'import', source], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PROFILE: '' },
    encoding: 'utf-8',
    timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('S3 the repo AI-engineering CV facts under qualified headings are imported', () => {
  const root = mkdtempSync(join(tmpdir(), 'issue-group5-headings-'));
  try {
    const out = preview(root, join(ROOT, 'cvs', 'cv-ai-engineering.md'));
    assert.match(out, /Found \d+ review candidates/);
    assert.match(out, /- experiences heading: ML\/LLM Research Intern/, 'AI & Machine Learning Experience');
    assert.match(out, /- experiences:.*Mined diffs/, 'experience facts');
    assert.match(out, /- projects heading: SRE Multi-Agent System/, 'Academic & Personal Projects');
    assert.match(out, /- projects:.*Kafka/, 'project facts');
    assert.match(out, /- education heading: Software Engineering Degree/);
    assert.match(out, /PyTorch/, 'skills section content');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('S3 the repo French CV facts under French headings are imported', () => {
  const root = mkdtempSync(join(tmpdir(), 'issue-group5-headings-'));
  try {
    const out = preview(root, join(ROOT, 'cvs', 'cv-fr.md'));
    assert.match(out, /- summary: Étudiant en 5e année/, 'Résumé professionnel');
    assert.match(out, /- experiences heading: Concordia Univ/, 'Expérience professionnelle');
    assert.match(out, /- experiences:.*Ingénierie de features/, 'experience facts');
    assert.match(out, /- projects heading: SpecTraceAi/, 'Projets');
    assert.match(out, /- education heading: Diplôme d'ingénieur/, 'Formation');
    assert.match(out, /- skills:.*Next\.js/, 'Compétences');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('S3 Indonesian and qualified headings classify; unknown headings do not leak prose', () => {
  const root = mkdtempSync(join(tmpdir(), 'issue-group5-headings-'));
  try {
    const source = join(root, 'cv.md');
    writeFileSync(source, [
      '# Candidate',
      '',
      '## AI & Machine Learning Experience',
      '### Acme — Intern',
      '- Built a model.',
      '',
      '## Academic & Personal Projects',
      '### SideQuest',
      '- Shipped a tool.',
      '',
      '## Pengalaman Kerja',
      '### Other Co',
      '- Did work.',
      '',
      '## Pendidikan',
      '- Degree X',
      '',
      '## Keahlian',
      '- Python, Go',
      '',
      '## Activités & Langues',
      '- Organized workshops',
      '',
    ].join('\n'));
    const out = preview(root, source);
    assert.match(out, /- experiences heading: Acme — Intern/);
    assert.match(out, /- experiences:.*Built a model/);
    assert.match(out, /- projects heading: SideQuest/);
    assert.match(out, /- projects:.*Shipped a tool/);
    assert.match(out, /- experiences heading: Other Co/);
    assert.match(out, /- education heading: Degree X/);
    assert.match(out, /- skills: Python/);
    assert.doesNotMatch(out, /Organized workshops/, 'unknown heading ends the section');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
