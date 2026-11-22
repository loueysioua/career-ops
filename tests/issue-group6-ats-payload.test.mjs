// tests/issue-group6-ats-payload.test.mjs — regressions for the ATS payload
// issues in group 6 (items A5, A8, A9, A10): an over-broad client marker,
// season/quarter date ranges, validation of the exported transform functions,
// and the (now accurate) rationale for the single competencies fold.
//
// HERMETIC: imports only; reads no user data. The one source read below is the
// sibling build-cv-html.mjs in this repo, used to pin the documented delimiter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lintPayload,
  countDateRanges,
  foldCompetencies,
  transformPayload,
  validatePayloadShape,
} from '../ats-payload.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const codes = (payload) => lintPayload(payload).map((f) => f.code);

// ── A5: CLIENT_MARKER_RE must not fire on ordinary titles ────────────────────

test('A5 "Customer Success Engineer", "Customer Engineer" and "... via ..." stop linting', () => {
  for (const role of [
    'Customer Success Engineer',
    'Customer Engineer',
    'Engineer via API gateway',
    'Senior Customer Platform Engineer',
  ]) {
    assert.deepEqual(
      codes({ experience: [{ company: 'Acme', role, dates: '2020 - 2022' }] }),
      [],
      `${role} must not produce a false employer-in-role finding`,
    );
  }
});

test('A5 a genuine retained-client marker still lints', () => {
  for (const role of ['Lead Engineer at Client', 'Engineer for Client', 'Client: Globex', 'Engineer on behalf of Acme']) {
    const findings = lintPayload({ experience: [{ company: 'Consultancy', role, dates: '2020 - 2022' }] });
    const finding = findings.find((f) => f.code === 'employer-in-role');
    assert.ok(finding, `${role} should lint`);
    assert.ok(finding.signals.includes('client-marker'));
  }
});

// ── A8: season/quarter dates count as multiple ranges ────────────────────────

test('A8 a season/quarter date string counts two ranges', () => {
  assert.equal(countDateRanges('Spring 2022 – Fall 2023, 2024 – Present'), 2);
  assert.equal(countDateRanges('Q1 2021 - Q4 2022'), 1);
});

test('A8 the multiple-date-ranges lint fires for the reported example', () => {
  assert.deepEqual(
    codes({ experience: [{ company: 'Acme', role: 'Engineer', dates: 'Spring 2022 – Fall 2023, 2024 – Present' }] }),
    ['multiple-date-ranges'],
  );
});

// ── A9: exported transform functions validate their input ────────────────────

test('A9 transformPayload refuses a non-array skills value instead of discarding it', () => {
  assert.throws(
    () => transformPayload({ competencies: ['AWS'], skills: 'Python' }),
    /refusing to transform a malformed payload[\s\S]*skills/,
  );
});

test('A9 foldCompetencies refuses members with no scalar value', () => {
  assert.throws(
    () => foldCompetencies({ competencies: ['AWS', { name: 'Kubernetes' }] }),
    /refusing to transform a malformed payload[\s\S]*no scalar value/,
  );
});

test('A9 foldCompetencies refuses a scalar items on the merge target', () => {
  assert.throws(
    () => foldCompetencies({ competencies: ['A'], skills: [{ category: 'Core Competencies', items: 2024 }] }),
    /refusing to transform a malformed payload[\s\S]*items` of type number/,
  );
});

test('A9 valid inputs keep their previous behaviour and are not mutated', () => {
  const payload = { competencies: ['RAG Pipelines'], skills: [{ category: 'Languages', items: 'Python, Go' }] };
  const before = JSON.stringify(payload);
  const result = transformPayload(payload);
  assert.equal(JSON.stringify(payload), before, 'the input must not be mutated');
  assert.equal(result.transform.applied, true);
  assert.deepEqual(result.payload.skills[0], { category: 'Core Competencies', items: 'RAG Pipelines' });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(validatePayloadShape(payload), []);
});

// ── A10: the fold rationale matches build-cv-html.mjs's real delimiter ───────

test('A10 build-cv-html still joins competencies with a comma delimiter', () => {
  const source = readFileSync(join(ROOT, 'build-cv-html.mjs'), 'utf-8');
  const builder = source.slice(source.indexOf('function buildCompetencies'), source.indexOf('function buildExperience'));
  assert.match(builder, /\.join\(', '\)/, 'the documented delimiter must actually be present');
  const folded = foldCompetencies({ competencies: ['A', 'B', 'C'] });
  assert.equal(folded.payload.skills[0].items, 'A, B, C');
});
