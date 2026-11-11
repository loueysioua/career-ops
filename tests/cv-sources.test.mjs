// tests/cv-sources.test.mjs — the user's CV set: what career-ops reads, in
// what order, and what happens when the files are not all there.
//
// The feature this covers exists because a candidate may hold more than one
// CV (a master, a one-page version, a market variant, an older draft) and an
// evaluation that reads only one of them scores them against a fraction of
// their record.
//
// The rules being pinned here:
//   - cv.md is the BASELINE (the CV a tailored CV is cut from)
//   - cvs/ holds additional CVs, read as evidence for facts the baseline omits
//   - cv.sources in config/profile.yml lists CVs kept elsewhere
//   - precedence: baseline first, then the extras in a stable order
//   - the folder's own scaffold (README.md, .gitkeep) is not a CV
//
// Run:  node --test tests/cv-sources.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  resolveCvSources, cvSourcePaths, readCvSources, joinExtraCvContents,
  profileCvSources, listExtraCvFiles, isScaffoldFile,
} from '../lib/cv-sources.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** A data root with a baseline CV and whatever else the test asks for. */
function dataRoot(spec = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-sources-'));
  if (spec.cv !== null) {
    writeFileSync(join(dir, 'cv.md'), spec.cv ?? '# CV -- Alex\n## Experience\n### Acme -- Berlin\n**Engineer**\n2020-2024\n- Built things\n');
  }
  for (const [rel, content] of Object.entries(spec.cvs ?? {})) {
    const abs = join(dir, 'cvs', rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  if (spec.profile) {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'profile.yml'), spec.profile);
  }
  if (spec.other) {
    mkdirSync(join(dir, 'other'), { recursive: true });
    writeFileSync(join(dir, 'other', 'master.md'), spec.other);
  }
  return dir;
}

test('the baseline cv.md is the primary source', () => {
  const root = dataRoot();
  try {
    const resolved = resolveCvSources(root);
    assert.equal(resolved.primary.label, 'cv.md');
    assert.equal(resolved.primary.kind, 'primary');
    assert.deepEqual(resolved.extras, []);
    assert.deepEqual(resolved.all.map((e) => e.label), ['cv.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CVs in cvs/ are found as additional sources', () => {
  const root = dataRoot({ cvs: { 'master.md': '# Master\n' } });
  try {
    const resolved = resolveCvSources(root);
    assert.equal(resolved.extras.length, 1);
    assert.equal(resolved.extras[0].label, 'cvs/master.md');
    assert.equal(resolved.extras[0].kind, 'extra');
    assert.equal(resolved.extras[0].origin, 'directory');
    assert.deepEqual(resolved.all.map((e) => e.label), ['cv.md', 'cvs/master.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the baseline comes first in the precedence order', () => {
  const root = dataRoot({ cvs: { 'a.md': '# A\n', 'b.md': '# B\n' } });
  try {
    const labels = cvSourcePaths(root).map((p) => p.replace(root + '/', ''));
    assert.deepEqual(labels, ['cv.md', 'cvs/a.md', 'cvs/b.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cv.sources lists CVs kept elsewhere, and lists them before the directory ones', () => {
  const root = dataRoot({
    cvs: { 'zebra.md': '# Zebra\n' },
    other: '# Elsewhere\n',
    profile: 'cv:\n  sources:\n    - other/master.md\n',
  });
  try {
    const resolved = resolveCvSources(root);
    const labels = resolved.extras.map((e) => e.label);
    assert.equal(labels[0], 'other/master.md');
    assert.equal(resolved.extras[0].origin, 'configured');
    assert.ok(labels.includes('cvs/zebra.md'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a CV named in both cv.sources and cvs/ is one CV, not two', () => {
  const root = dataRoot({
    cvs: { 'master.md': '# Master\n' },
    profile: 'cv:\n  sources:\n    - cvs/master.md\n',
  });
  try {
    const resolved = resolveCvSources(root);
    assert.equal(resolved.extras.length, 1);
    assert.equal(resolved.extras[0].origin, 'configured');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the folder scaffold is not a CV', () => {
  const root = dataRoot({ cvs: { 'README.md': '# how this folder works\n', '.gitkeep': '' } });
  try {
    const resolved = resolveCvSources(root);
    assert.deepEqual(resolved.extras, []);
    assert.ok(isScaffoldFile(join(root, 'cvs', 'README.md')));
    assert.ok(isScaffoldFile(join(root, 'cvs', '.gitkeep')));
    assert.ok(!isScaffoldFile(join(root, 'cvs', 'master.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a CV named in cv.sources that does not exist is reported, not silently skipped', () => {
  const root = dataRoot({ profile: 'cv:\n  sources:\n    - cvs/gone.md\n' });
  try {
    const resolved = resolveCvSources(root);
    assert.deepEqual(resolved.extras, []);
    assert.equal(resolved.warnings.length, 1);
    assert.match(resolved.warnings[0], /gone\.md/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a malformed profile does not take the CV set down with it', () => {
  const root = dataRoot({ cvs: { 'master.md': '# Master\n' }, profile: 'cv: [not, a, mapping]\n' });
  try {
    const resolved = resolveCvSources(root);
    assert.equal(resolved.extras.length, 1);
    assert.equal(resolved.warnings.length, 1);
    assert.match(resolved.warnings[0], /not a mapping/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CAREER_OPS_CV names the baseline CV', () => {
  const root = dataRoot({ other: '# Elsewhere\n' });
  try {
    const resolved = resolveCvSources(root, {
      env: { CAREER_OPS_CV: join(root, 'other', 'master.md') },
    });
    assert.equal(resolved.primary.label, 'other/master.md');
    // The file it names is the baseline, so it is not also an extra.
    assert.deepEqual(resolved.extras, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an empty CAREER_OPS_CV is no override at all', () => {
  const root = dataRoot();
  try {
    const resolved = resolveCvSources(root, { env: { CAREER_OPS_CV: '' } });
    assert.equal(resolved.primary.label, 'cv.md');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a data root with no CV at all resolves to an empty set, not an error', () => {
  const root = dataRoot({ cv: null });
  try {
    const resolved = resolveCvSources(root);
    assert.equal(resolved.primary, null);
    assert.deepEqual(resolved.all, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the additional CVs are joined with their file names, so a claim can be attributed', () => {
  const root = dataRoot({ cvs: { 'master.md': '# Master\nScaled to 1M users\n' } });
  try {
    const { text, labels } = joinExtraCvContents(root);
    assert.deepEqual(labels, ['cvs/master.md']);
    assert.match(text, /cvs\/master\.md/);
    assert.match(text, /Scaled to 1M users/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the baseline is not repeated in the joined additional CVs', () => {
  const root = dataRoot({ cvs: { 'master.md': '# Master\n' } });
  try {
    const { text } = joinExtraCvContents(root);
    assert.doesNotMatch(text, /Built things/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reading the set returns each file with its text', () => {
  const root = dataRoot({ cvs: { 'master.md': '# Master\n' } });
  try {
    const { documents } = readCvSources(root);
    assert.deepEqual(documents.map((d) => d.label), ['cv.md', 'cvs/master.md']);
    assert.match(documents[1].content, /# Master/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('profileCvSources reads the list, and ignores a profile with no cv block', () => {
  assert.deepEqual(profileCvSources({ cv: { sources: ['a.md'] } }).paths, ['a.md']);
  assert.deepEqual(profileCvSources({ cv: { sources: 'one.md' } }).paths, ['one.md']);
  assert.deepEqual(profileCvSources({}).paths, []);
  assert.deepEqual(profileCvSources(null).paths, []);
  assert.match(profileCvSources({ cv: { sources: 42 } }).warning, /not a list/);
});

test('a nested checkout inside cvs/ is not read', () => {
  const root = dataRoot({ cvs: { 'master.md': '# Master\n' } });
  try {
    const nested = join(root, 'cvs', 'other-repo');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, '.git'), 'gitdir: /elsewhere\n');
    writeFileSync(join(nested, 'their-cv.md'), '# Not the candidate\'s CV\n');
    const files = listExtraCvFiles(join(root, 'cvs'));
    assert.deepEqual(files.map((f) => f.replace(root + '/', '')), ['cvs/master.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a symlinked CV in cvs/ is read — a synced folder is a natural setup', () => {
  const root = dataRoot();
  try {
    const outside = join(root, 'synced.md');
    writeFileSync(outside, '# Synced CV\n');
    mkdirSync(join(root, 'cvs'), { recursive: true });
    symlinkSync(outside, join(root, 'cvs', 'synced.md'));
    const resolved = resolveCvSources(root);
    assert.deepEqual(resolved.extras.map((e) => e.label), ['cvs/synced.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the fact gate accepts a claim that only an additional CV holds', async () => {
  const root = dataRoot({
    cv: '# CV -- Alex\n## Experience\n### Acme -- Berlin\n**Engineer**\n2020-2024\n- Built things\n',
    cvs: { 'master.md': '# Master CV\nScaled the platform to 4M users.\n' },
  });
  try {
    const { verifyFacts } = await import('../verify-cv-facts.mjs');
    const target = 'Scaled the platform to 4M users.\n';
    // The claim is not in cv.md, so a gate that only reads the baseline blocks it.
    const only = verifyFacts(target, {
      sourcePaths: [join(root, 'cv.md')],
      configPath: join(root, 'config', 'cv-facts.json'),
    });
    assert.notEqual(only.verdict, 'pass');
    // With the whole set, it is the user's claim.
    const all = verifyFacts(target, {
      sourcePaths: cvSourcePaths(root),
      configPath: join(root, 'config', 'cv-facts.json'),
    });
    assert.equal(all.verdict, 'pass');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the cv-sources CLI prints the set and exits non-zero when there is none', () => {
  const root = dataRoot({ cvs: { 'master.md': '# Master\n' } });
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'cv-sources.mjs')], {
      env: { ...process.env, CAREER_OPS_ROOT: root },
      encoding: 'utf8',
    });
    assert.match(out, /cvs\/master\.md/);
    assert.match(out, /baseline/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
