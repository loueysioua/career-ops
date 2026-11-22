// tests/issue-group5-profile-evidence.test.mjs — S7: re-import must not leave
// a verified fact pointing at source wording that changed since verification.
//
// Run: node --test tests/issue-group5-profile-evidence.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'career-profile.mjs');
const CV = [
  '# Candidate',
  '',
  '## Experience',
  '### Acme — Analyst',
  '- Built dashboards with SQL.',
  '',
  '## Skills',
  '- SQL, Excel',
  '',
].join('\n');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'issue-group5-evidence-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), CV);
  return root;
}

function approveAll(root) {
  const result = spawnSync(process.execPath, [CLI, 'import', 'cv.md', '--review'], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PROFILE: '' },
    encoding: 'utf-8',
    input: 'y\ny\ny\ny\n',
    timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
}

test('S7 changed source wording resets review_status while the display text is preserved', () => {
  const root = setup();
  try {
    const first = approveAll(root);
    assert.equal(first.experiences[0].facts[0].review_status, 'verified');
    assert.equal(first.skills.find((s) => s.text === 'SQL').review_status, 'verified');
    assert.equal(first.experiences[0].facts[0].evidence.quote, '- Built dashboards with SQL.');

    // Only the bullet marker changes: the extracted fact text (and therefore
    // the stable id) is identical, but the evidence quote is different bytes.
    writeFileSync(join(root, 'cv.md'), CV
      .replace('- Built dashboards with SQL.', '* Built dashboards with SQL.')
      .replace('- SQL, Excel', '* SQL, Excel'));
    const second = approveAll(root);

    const fact = second.experiences[0].facts[0];
    assert.equal(second.experiences.length, 1);
    assert.equal(second.experiences[0].facts.length, 1, 'the fact is updated, not duplicated');
    assert.equal(fact.text, 'Built dashboards with SQL.', 'unedited display text is preserved');
    assert.equal(fact.evidence.quote, '* Built dashboards with SQL.', 'evidence is replaced');
    assert.equal(fact.review_status, 'needs_review', 'a verified fact no longer points at unapproved wording');
    for (const text of ['SQL', 'Excel']) {
      const skill = second.skills.find((s) => s.text === text);
      assert.ok(skill, `${text} skill exists`);
      assert.equal(skill.evidence.quote, '* SQL, Excel');
      assert.equal(skill.review_status, 'needs_review');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('S7 byte-identical evidence keeps the verified status across re-import', () => {
  const root = setup();
  try {
    const first = approveAll(root);
    assert.equal(first.experiences[0].facts[0].review_status, 'verified');
    const second = approveAll(root);
    assert.equal(second.experiences[0].facts[0].review_status, 'verified');
    assert.equal(second.experiences[0].facts[0].text, 'Built dashboards with SQL.');
    assert.equal(second.skills.find((s) => s.text === 'SQL').review_status, 'verified');
    assert.equal(second.skills.length, 2, 'no duplicate skills');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
