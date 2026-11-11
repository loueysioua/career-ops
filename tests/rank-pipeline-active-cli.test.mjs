import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { envWithPathFirst, writeFakeCli } from './helpers/fake-cli.mjs';

test('CAREER_OPS_CLI picks the ranking CLI when several are installed', () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-active-cli-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'data', 'pipeline.md'), '- [ ] https://example.test/job | Example | Engineer');
    for (const cli of ['claude', 'opencode']) {
      // Record the flags, not the prompt: the prompt is the last argv entry.
      writeFakeCli(join(root, 'bin'), cli,
        `if (process.argv[2] !== '--version') require('node:fs').writeFileSync(process.env.RANK_CALL, ${JSON.stringify(cli)} + ' ' + process.argv.slice(2, -1).join(' '));\n`
        + `console.log('[{"id":0,"score":3,"reason":"Fixture match"}]');\n`);
    }
    const env = envWithPathFirst(join(root, 'bin'), {
      CAREER_OPS_ROOT: root,
      CAREER_OPS_CLI: 'opencode',
      CAREER_OPS_RANK_CLI: '',
      RANK_CALL: join(root, 'call.txt'),
    });
    execFileSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--dry-run'], { env, cwd: root });
    // `--standalone` is not decoration: OPENCODE_CONFIG_CONTENT is read by the
    // OpenCode SERVER, and without a private server the run attaches to the
    // shared background one, whose environment is not this process's — so the
    // deny rules never arrive.
    assert.equal(readFileSync(env.RANK_CALL, 'utf8'), 'opencode run --standalone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
