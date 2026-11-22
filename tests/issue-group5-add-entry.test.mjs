// tests/issue-group5-add-entry.test.mjs — S4: `add` must dedup against the
// whole CV set, not only cv.md, while still writing the baseline.
//
// Run: node --test tests/issue-group5-add-entry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyAdd } from '../add-entry.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'add-entry.mjs');
const BASELINE = '# CV -- Test\n\n## Projects\n\n- **Alpha** (OSS) -- first\n\n';
const EXTRA = '# Master\n\n## Projects\n\n- **Beta** (OSS) -- second\n\n';

test('S4 applyAdd treats an entry already in an additional CV as a duplicate', () => {
  const payload = {
    cv: { section: 'Projects', dedupKey: 'Beta', entry: '- **Beta** (OSS) -- second' },
  };
  const out = applyAdd(payload, { cvText: BASELINE, otherCvTexts: [EXTRA] });
  assert.equal(out.result.cv.status, 'duplicate');
  assert.equal(out.cv, BASELINE, 'the baseline is left untouched');

  const fresh = applyAdd({
    cv: { section: 'Projects', dedupKey: 'Gamma', entry: '- **Gamma** (OSS) -- third' },
  }, { cvText: BASELINE, otherCvTexts: [EXTRA] });
  assert.equal(fresh.result.cv.status, 'added');
  assert.match(fresh.cv, /Gamma/);
});

test('S4 the add-entry CLI dedups against cvs/* and still writes to cv.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'issue-group5-addentry-'));
  try {
    mkdirSync(join(root, 'cvs'), { recursive: true });
    writeFileSync(join(root, 'cv.md'), BASELINE);
    writeFileSync(join(root, 'cvs', 'master.md'), EXTRA);
    const payloadPath = join(root, 'payload.json');
    const run = (dedupKey) => {
      writeFileSync(payloadPath, JSON.stringify({
        cv: { section: 'Projects', dedupKey, entry: `- **${dedupKey}** (OSS) -- new` },
      }));
      const result = spawnSync(process.execPath, [CLI, payloadPath, '--dry-run'], {
        cwd: ROOT,
        env: {
          ...process.env,
          CAREER_OPS_ROOT: root,
          CAREER_OPS_CV: '',
          CAREER_OPS_PROFILE: '',
        },
        encoding: 'utf-8',
        timeout: 15000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return JSON.parse(result.stdout);
    };

    assert.equal(run('Beta').cv.status, 'duplicate', 'already present in cvs/master.md');
    assert.equal(run('Gamma').cv.status, 'added', 'a genuinely new entry still lands');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
