// tests/opencode-skill-invocation.test.mjs — the /career-ops slash commands
// actually load the skill in OpenCode.
//
// OpenCode's skill tool takes the skill's ID: `{"id": "career-ops"}`. The
// `name` parameter is Claude Code's. The commands shipped
// `skill({ name: "career-ops" })`, which OpenCode does not accept, so
// `/career-ops` in OpenCode never loaded the router — the command ran and the
// agent had no mode instructions.
//
// The ID is path-derived, not the frontmatter name: `.opencode/skills/
// career-ops/SKILL.md` → `career-ops`. It is exact and case-sensitive.
//
// Run:  node --test tests/opencode-skill-invocation.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COMMANDS_DIR = join(ROOT, '.opencode', 'commands');
const SKILL_FILE = join(ROOT, '.opencode', 'skills', 'career-ops', 'SKILL.md');

function commandFiles() {
  if (!existsSync(COMMANDS_DIR)) return [];
  return readdirSync(COMMANDS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(COMMANDS_DIR, name));
}

test('the OpenCode commands exist and there is more than one', () => {
  const files = commandFiles();
  assert.ok(files.length > 0, 'no OpenCode commands found under .opencode/commands');
});

test('every OpenCode command loads the skill by its path-derived ID', () => {
  for (const file of commandFiles()) {
    const source = readFileSync(file, 'utf-8');
    assert.match(
      source,
      /skill\(\{\s*id:\s*["']career-ops["']\s*\}\)/,
      `${file} does not load the skill the way OpenCode expects — the skill tool takes an "id", not a "name"`,
    );
    assert.doesNotMatch(
      source,
      /skill\(\{\s*name:/,
      `${file} uses the Claude Code skill parameter ("name"), which OpenCode does not accept`,
    );
  }
});

test('the skill the commands load is the one OpenCode can find', () => {
  assert.ok(existsSync(SKILL_FILE), '.opencode/skills/career-ops/SKILL.md is missing');
  // A symlink to the shared router is fine — it is the same file. What must
  // hold is that the path derives the ID the command passes.
  const real = realpathSync(SKILL_FILE);
  assert.ok(existsSync(real), 'the skill symlink does not resolve');
  const text = readFileSync(real, 'utf-8');
  assert.match(text, /^---\n/, 'the shared router has no frontmatter');
  assert.match(text, /\nname:\s*career-ops\s*\n/, 'the shared router is not named career-ops');
});

test('the ID the commands pass is the ID OpenCode derives from the path', () => {
  // .opencode/skills/<id>/SKILL.md -> <id>, and the segment must be the
  // kebab-case ID OpenCode documents.
  const segments = join('.opencode', 'skills', 'career-ops', 'SKILL.md').split(/[\\/]/);
  const id = segments[segments.length - 2];
  assert.equal(id, 'career-ops');
  assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('the commands are declared as system paths, so an update keeps them', () => {
  const manifest = readFileSync(join(ROOT, 'lib', 'update-manifest.mjs'), 'utf-8');
  assert.match(manifest, /\.opencode\/commands\//, 'update-manifest.mjs does not ship .opencode/commands/');
});

test('the OpenCode guide exists and points at the skill ID', () => {
  const doc = join(ROOT, 'docs', 'OPENCODE.md');
  assert.ok(existsSync(doc), 'docs/OPENCODE.md is missing');
  const text = readFileSync(doc, 'utf-8');
  assert.match(text, /career-ops/, 'the guide never names the skill');
  assert.match(text, /"id"/, 'the guide never shows the id parameter');
});
