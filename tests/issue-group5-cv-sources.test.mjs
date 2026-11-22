// tests/issue-group5-cv-sources.test.mjs — regression tests for the
// MULTIPLE-CV / SOURCE-OF-TRUTH audit, group 5:
//   S1  `~` in user-supplied CV paths is expanded
//   S2  resolveCvSources honours CAREER_OPS_PROFILE
//   S5  opts.includeMissing reports missing sources instead of only warning
//   S6  CV dedup uses realpath, so a symlinked CV is not counted twice
//
// Run: node --test tests/issue-group5-cv-sources.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  expandHomePath, canonicalCvPath, resolveConfiguredCvPaths,
  resolveCvSources, cvSourcePaths, readCvSources,
} from '../lib/cv-sources.mjs';
import { getProfilePath } from '../path-resolver.mjs';

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'issue-group5-cvsources-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), '# Baseline\n\n## Experience\n### Acme\n- Built things\n');
  return root;
}

function cleanup(...dirs) {
  for (const dir of dirs) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ── S1: tilde expansion ─────────────────────────────────────────────────────

test('S1 expandHomePath expands a leading ~ and ~/ but leaves other forms alone', () => {
  const home = '/tmp/fake-home';
  assert.equal(expandHomePath('~', home), home);
  assert.equal(expandHomePath('~/master.md', home), join(home, 'master.md'));
  assert.equal(expandHomePath('~\\master.md', home), join(home, 'master.md'));
  assert.equal(expandHomePath('/abs/master.md', home), '/abs/master.md');
  assert.equal(expandHomePath('relative/master.md', home), 'relative/master.md');
  assert.equal(expandHomePath('~someone/master.md', home), '~someone/master.md');
});

test('S1 a ~/ path in cv.sources resolves to the home directory, not <root>/~', () => {
  const root = scratch();
  const home = mkdtempSync(join(tmpdir(), 'issue-group5-home-'));
  try {
    const cvPath = join(home, 'master.md');
    writeFileSync(cvPath, '# Master\n');
    writeFileSync(join(root, 'config', 'profile.yml'), 'cv:\n  sources:\n    - ~/master.md\n');
    const resolved = resolveCvSources(root, { home });
    assert.deepEqual(resolved.extras.map((e) => e.path), [cvPath]);
    assert.equal(resolved.extras[0].origin, 'configured');
    assert.equal(resolved.warnings.length, 0);
  } finally { cleanup(root, home); }
});

test('S1 CAREER_OPS_CV with a ~/ path also expands', () => {
  const root = scratch();
  const home = mkdtempSync(join(tmpdir(), 'issue-group5-home-'));
  try {
    const cvPath = join(home, 'baseline.md');
    writeFileSync(cvPath, '# Alternate baseline\n');
    const resolved = resolveCvSources(root, {
      home,
      env: { CAREER_OPS_CV: '~/baseline.md' },
    });
    assert.equal(resolved.primary?.path, cvPath);
    assert.equal(resolved.primary?.label, 'baseline.md');
  } finally { cleanup(root, home); }
});

// ── S2: CAREER_OPS_PROFILE in resolveCvSources ──────────────────────────────

test('S2 resolveCvSources reads cv.sources from CAREER_OPS_PROFILE, not the data-root profile', () => {
  const root = scratch();
  try {
    const listed = join(root, 'other', 'from-override.md');
    mkdirSync(dirname(listed), { recursive: true });
    writeFileSync(listed, '# Override-listed CV\n');
    // Kept outside cvs/ so it can only be found through the data-root
    // profile — a directory scan would otherwise pick it up either way.
    const inDataRoot = join(root, 'other', 'from-root.md');
    mkdirSync(dirname(inDataRoot), { recursive: true });
    writeFileSync(inDataRoot, '# Root-listed CV\n');

    writeFileSync(join(root, 'config', 'profile.yml'), 'cv:\n  sources:\n    - other/from-root.md\n');
    const overrideProfile = join(root, 'named-profile.yml');
    writeFileSync(overrideProfile, 'cv:\n  sources:\n    - other/from-override.md\n');

    const resolved = resolveCvSources(root, { env: { CAREER_OPS_PROFILE: overrideProfile } });
    assert.deepEqual(resolved.extras.map((e) => e.path), [listed]);
    assert.equal(resolved.extras[0].origin, 'configured');
  } finally { cleanup(root); }
});

test('S2 an explicit profilePath or parsed profile still wins over the env override', () => {
  const root = scratch();
  try {
    const listed = join(root, 'other', 'from-explicit.md');
    mkdirSync(dirname(listed), { recursive: true });
    writeFileSync(listed, '# Explicit\n');
    const explicit = join(root, 'explicit-profile.yml');
    writeFileSync(explicit, `cv:\n  sources:\n    - ${listed}\n`);
    const override = join(root, 'named-profile.yml');
    writeFileSync(override, 'cv:\n  sources:\n    - missing-in-override.md\n');

    const viaPath = resolveCvSources(root, {
      profilePath: explicit,
      env: { CAREER_OPS_PROFILE: override },
    });
    assert.deepEqual(viaPath.extras.map((e) => e.path), [listed]);

    const viaDocument = resolveCvSources(root, {
      profile: { cv: { sources: [listed] } },
      env: { CAREER_OPS_PROFILE: override },
    });
    assert.deepEqual(viaDocument.extras.map((e) => e.path), [listed]);
  } finally { cleanup(root); }
});

test('S2 getProfilePath(root) still ignores the override (documented precedence preserved)', () => {
  const root = scratch();
  try {
    const override = join(root, 'named-profile.yml');
    writeFileSync(override, 'candidate: {}\n');
    const original = process.env.CAREER_OPS_PROFILE;
    try {
      process.env.CAREER_OPS_PROFILE = override;
      assert.equal(getProfilePath(root), join(root, 'config', 'profile.yml'));
      assert.equal(getProfilePath(), override);
    } finally {
      if (original === undefined) delete process.env.CAREER_OPS_PROFILE;
      else process.env.CAREER_OPS_PROFILE = original;
    }
  } finally { cleanup(root); }
});

// ── S5: includeMissing ──────────────────────────────────────────────────────

test('S5 includeMissing reports missing configured CVs as explicit entries', () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'config', 'profile.yml'), 'cv:\n  sources:\n    - cvs/gone.md\n');

    const without = resolveCvSources(root);
    assert.deepEqual(without.extras, []);
    assert.deepEqual(without.missing, []);
    assert.equal(without.warnings.length, 1);

    const withMissing = resolveCvSources(root, { includeMissing: true });
    assert.equal(withMissing.missing.length, 1);
    const [entry] = withMissing.missing;
    assert.equal(entry.missing, true);
    assert.match(entry.reason, /gone\.md/);
    assert.equal(entry.path, join(root, 'cvs', 'gone.md'));
    assert.equal(entry.kind, 'extra');
    assert.equal(entry.origin, 'configured');
    assert.ok(withMissing.all.includes(entry));
    assert.ok(withMissing.extras.includes(entry));
    // A missing file is never handed to a reader as a path to open.
    assert.deepEqual(cvSourcePaths(root, { includeMissing: true }), [join(root, 'cv.md')]);
    assert.deepEqual(readCvSources(root, { includeMissing: true }).documents.map((d) => d.label), ['cv.md']);
  } finally { cleanup(root); }
});

test('S5 includeMissing reports a mistyped CAREER_OPS_CV baseline', () => {
  const root = scratch();
  try {
    const env = { CAREER_OPS_CV: 'cv-typo.md' };
    const without = resolveCvSources(root, { env });
    assert.equal(without.primary, null);
    assert.deepEqual(without.missing, []);

    const withMissing = resolveCvSources(root, { env, includeMissing: true });
    assert.equal(withMissing.primary, null);
    assert.equal(withMissing.missing.length, 1);
    assert.equal(withMissing.missing[0].kind, 'primary');
    assert.equal(withMissing.missing[0].missing, true);
    assert.match(withMissing.missing[0].reason, /cv-typo\.md/);
    assert.deepEqual(cvSourcePaths(root, { env, includeMissing: true }), []);
  } finally { cleanup(root); }
});

test('S5 resolveConfiguredCvPaths keeps existing paths separate from missing ones', () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'here.md'), '# Here\n');
    const out = resolveConfiguredCvPaths(root, ['here.md', 'there.md'], { includeMissing: true });
    assert.deepEqual(out.paths, [join(root, 'here.md')]);
    assert.equal(out.missing.length, 1);
    assert.equal(out.missing[0].raw, 'there.md');
    assert.equal(out.warnings.length, 1);
    const plain = resolveConfiguredCvPaths(root, ['here.md', 'there.md']);
    assert.deepEqual(Object.keys(plain).sort(), ['missing', 'paths', 'warnings']);
    assert.deepEqual(plain.missing, []);
  } finally { cleanup(root); }
});

// ── S6: realpath dedup ──────────────────────────────────────────────────────

test('S6 a symlinked CV in cvs/ and the same file in cv.sources are one CV', () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'synced.md'), '# Synced\n');
    const canonical = canonicalCvPath(join(root, 'synced.md'));
    mkdirSync(join(root, 'cvs'), { recursive: true });
    symlinkSync(join(root, 'synced.md'), join(root, 'cvs', 'synced.md'));
    writeFileSync(join(root, 'config', 'profile.yml'), 'cv:\n  sources:\n    - synced.md\n');

    const resolved = resolveCvSources(root);
    assert.equal(resolved.extras.length, 1);
    assert.equal(resolved.extras[0].origin, 'configured');
    assert.equal(canonicalCvPath(resolved.extras[0].path), canonical);
  } finally { cleanup(root); }
});

test('S6 the baseline and an extra that are the same file via a symlink are one CV', () => {
  const root = scratch();
  try {
    const real = join(root, 'real-baseline.md');
    writeFileSync(real, '# Real baseline\n');
    rmSync(join(root, 'cv.md'), { force: true });
    symlinkSync(real, join(root, 'cv.md'));
    mkdirSync(join(root, 'cvs'), { recursive: true });
    symlinkSync(real, join(root, 'cvs', 'copy.md'));

    const resolved = resolveCvSources(root, {
      env: { CAREER_OPS_CV: 'cv.md' },
      profile: { cv: { sources: ['cvs/copy.md'] } },
    });
    assert.ok(resolved.primary);
    assert.deepEqual(resolved.extras, []);
    assert.deepEqual(resolved.all.map((e) => e.kind), ['primary']);
  } finally { cleanup(root); }
});

test('S6 canonicalCvPath falls back to resolve for a path that does not exist', () => {
  const missing = join(tmpdir(), 'issue-group5-no-such-cv.md');
  assert.equal(canonicalCvPath(missing), resolve(missing));
});
