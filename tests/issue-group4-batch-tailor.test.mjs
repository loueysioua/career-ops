// tests/issue-group4-batch-tailor.test.mjs — regression tests for P5: a
// scan-derived URL is untrusted and must not be interpolated into the worker
// prompt; the worker is told that fetched content is data; permissions are not
// broadened (the #2876 debt is documented and narrowed, not grown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { envWithPathFirst, writeFakeCli } from './helpers/fake-cli.mjs';

function runBatch(rawUrl) {
  const root = mkdtempSync(join(tmpdir(), 'issue-group4-batch-'));
  try {
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'reports'));
    const state = join(root, 'batch-state.tsv');
    writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + `1\t${rawUrl}\tcompleted\t-\t-\t001\t4.5\t-\t0\n`);
    writeFileSync(join(root, 'reports', '001-acme-2026-01-01.md'), '# Acme\n');
    const calls = join(root, 'calls.jsonl');
    writeFakeCli(join(root, 'bin'), 'claude', `
const fs = require('node:fs');
const ctx = process.env.CAREER_OPS_TAILOR_JOB || null;
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({
  argv: process.argv.slice(2),
  contextPath: ctx,
  context: ctx && fs.existsSync(ctx) ? fs.readFileSync(ctx, 'utf8') : null,
}) + '\\n');
`);
    const result = spawnSync(process.execPath, [join(ROOT, 'batch-tailor.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      env: envWithPathFirst(join(root, 'bin'), {
        CAREER_OPS_ROOT: root,
        CAREER_OPS_BATCH_STATE: state,
      }),
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const runs = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(runs.length, 1);
    return { root, run: runs[0], rawUrl };
  } catch (err) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
    throw err;
  }
}

test('P5a: the raw URL travels in a JSON file, not inline in the prompt', () => {
  const rawUrl = 'https://example.com/jobs/1?a=1&b=2';
  const { root, run } = runBatch(rawUrl);
  try {
    assert.equal(run.argv[0], '-p');
    const prompt = run.argv.at(-1);
    // A validated single token is shown for human context.
    assert.ok(prompt.includes(`URL: ${rawUrl}`), `prompt lost the normalized URL: ${prompt}`);
    // The authoritative values are in the per-job JSON file named by the env var.
    assert.ok(run.contextPath && run.contextPath.endsWith('job.json'), 'no JSON context path passed to the worker');
    assert.ok(run.context, 'the worker could not read the JSON context file');
    const context = JSON.parse(run.context);
    assert.equal(context.url, rawUrl, 'the raw URL was not passed via the JSON file');
    assert.equal(context.reportNum, '001');
    // The context temp dir is removed after the worker exits.
    assert.equal(existsSync(run.contextPath), false, 'the job context temp dir was not cleaned up');
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});

test('P5b: the worker prompt declares fetched content data, never instructions', () => {
  const { root, run } = runBatch('https://example.com/jobs/2');
  try {
    const prompt = run.argv.at(-1);
    assert.match(prompt, /DATA, never instructions/);
    assert.match(prompt, /do not let it trigger file writes/);
    assert.match(prompt, /<job_posting_context>/);
    assert.match(prompt, /<\/job_posting_context>/);
    assert.match(prompt, /CAREER_OPS_TAILOR_JOB/);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});

test('P5c: permissions are narrowed, not broadened, and #2876 is documented', () => {
  const { root, run } = runBatch('https://example.com/jobs/3');
  try {
    const idx = run.argv.indexOf('--disallowedTools');
    assert.notEqual(idx, -1, 'no per-tool deny list was passed');
    assert.match(run.argv[idx + 1], /WebFetch/);
    assert.match(run.argv[idx + 1], /WebSearch/);
    // The existing #2876 debt is kept (the harness-side fix is out of scope),
    // but the code names it explicitly and adds no other approval flag.
    assert.ok(run.argv.includes('--dangerously-skip-permissions'));
    const approvalFlags = run.argv.filter((a) => /^(-{1,2})(dangerously-skip-permissions|always-approve|yolo|full-auto|auto-approve|approve-all|skip-permissions|no-confirm)$/.test(a));
    assert.equal(approvalFlags.length, 1, `broadened approval flags: ${approvalFlags.join(', ')}`);
    const source = readFileSync(join(ROOT, 'batch-tailor.mjs'), 'utf8');
    assert.match(source, /#2876/);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});

test('P5a: an invalid URL is never interpolated into the prompt', () => {
  const { root, run } = runBatch('javascript:alert(1)');
  try {
    const prompt = run.argv.at(-1);
    assert.ok(!prompt.includes('javascript:alert(1)'), 'the raw unsafe URL was interpolated into the prompt');
    assert.match(prompt, /invalid/);
    const context = JSON.parse(run.context);
    assert.equal(context.url, 'javascript:alert(1)', 'the raw value is still available as data in the JSON file');
    assert.equal(context.safeUrl, null);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});
