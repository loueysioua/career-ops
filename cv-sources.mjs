#!/usr/bin/env node

/**
 * cv-sources.mjs — show the CV set career-ops reads.
 *
 * A candidate may hold more than one CV: a long master, a one-page version, a
 * market variant, an older draft. career-ops reads all of them, and this
 * script shows exactly which files that is, in precedence order — the order
 * that decides who wins when two of them disagree about a fact.
 *
 * It is the answer to "is my extra CV actually being read?" without having to
 * read a log.
 *
 * Usage:
 *   node cv-sources.mjs              # the resolved set, as a table
 *   node cv-sources.mjs --json       # the same, as JSON
 *   node cv-sources.mjs --summary    # counts only
 *   node cv-sources.mjs --help
 *
 * Read-only. It never writes, and it never contacts the network.
 */

import { existsSync } from 'fs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { resolveCvSources } from './lib/cv-sources.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const USAGE = `
cv-sources.mjs — show the CVs career-ops reads, in precedence order

Usage:
  node cv-sources.mjs              # the resolved set, as a table
  node cv-sources.mjs --json       # the same, as JSON
  node cv-sources.mjs --summary    # counts only
  node cv-sources.mjs --help

The baseline is cv.md — the CV a tailored CV is cut from. The others are
additional CVs (cvs/, plus anything listed under cv.sources in
config/profile.yml) read as evidence for facts the baseline omits.

Precedence when two files disagree: article-digest.md, then cv.md, then the
additional CVs in the order shown here.
`;

function formatTable(resolved) {
  const rows = resolved.all.map((entry, index) => ({
    order: index + 1,
    role: entry.kind === 'primary' ? 'baseline' : 'additional',
    file: entry.label,
    origin: entry.origin ?? '—',
  }));
  if (!rows.length) return 'No CV found.';
  const width = Math.max(...rows.map((r) => r.file.length));
  const lines = rows.map((r) =>
    `  ${String(r.order).padStart(2)}. ${r.role.padEnd(9)} ${r.file.padEnd(width)}  (${r.origin})`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE.trim());
    return 0;
  }
  const json = argv.includes('--json');
  const summary = argv.includes('--summary');
  const root = getCareerOpsRoot();
  const resolved = resolveCvSources(root, { profilePath: getProfilePath() });

  if (json) {
    console.log(JSON.stringify({
      dataRoot: root,
      primary: resolved.primary,
      extras: resolved.extras,
      all: resolved.all,
      extraDir: resolved.extraDir,
      warnings: resolved.warnings,
    }, null, 2));
    return resolved.all.length ? 0 : 1;
  }

  if (summary) {
    console.log(`CVs: ${resolved.all.length} (${resolved.extras.length} additional)`);
    for (const warning of resolved.warnings) console.log(`⚠️  ${warning}`);
    return resolved.all.length ? 0 : 1;
  }

  console.log(`Data root: ${root}`);
  console.log('');
  console.log(formatTable(resolved));
  console.log('');
  if (resolved.extras.length) {
    console.log('  Additional CVs are read as evidence for facts cv.md omits. They never');
    console.log('  change the baseline\'s structure. See cvs/README.md.');
  } else {
    console.log('  No additional CVs found. Drop more into cvs/ and they are read too.');
  }
  for (const warning of resolved.warnings) console.log(`⚠️  ${warning}`);
  return resolved.all.length ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
