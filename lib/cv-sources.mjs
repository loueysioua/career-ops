/**
 * lib/cv-sources.mjs — the user's CV set, resolved from the data root.
 *
 * career-ops used to assume exactly one CV: `{DATA_ROOT}/cv.md`. That file is
 * still the CV a tailored CV is cut from, but it is no longer the only thing
 * the user has written about themselves. A candidate may hold a long master
 * CV, a short one-page version, a variant for another market, or an older
 * version that still holds a detail the new one dropped — and an evaluation
 * that reads only one file scores them against a fraction of their record.
 *
 * This module is the single seam that decides which CVs exist. Everything
 * else asks it, so one implementation of "the user's CVs" exists rather than
 * one per script (the rule web/AGENTS.md states for the web app, applied
 * here so the two halves cannot drift).
 *
 * Two roles, deliberately kept apart:
 *
 *   - **baseline** — `cv.md` (or whatever `CAREER_OPS_CV` names). The CV a
 *     tailored CV is cut from. Its section order is the order the renderer
 *     validates against, so it must stay one file.
 *   - **evidence** — the baseline plus every additional CV. These widen what
 *     the model knows; they never widen what the renderer believes it is
 *     allowed to reorder.
 *
 * Where the CVs are:
 *
 *   1. `{DATA_ROOT}/cv.md` — the baseline. `CAREER_OPS_CV` overrides the
 *      path, matching the two scripts that already honoured it
 *      (`add-entry.mjs` writes there, `scripts/export-ats-text.mjs` reads
 *      from there). One meaning, one variable.
 *   2. `{DATA_ROOT}/cvs/` — additional CVs, one file each. Dropped in by
 *      hand, or produced by the `intake` mode.
 *   3. `config/profile.yml` → `cv.sources` — an explicit list of additional
 *      CV paths, relative to the data root or absolute. Listed files come
 *      first, so listing is also how a user states precedence.
 *
 * Precedence, highest first, when two files disagree about a fact:
 *
 *   1. `article-digest.md` (not resolved here — it is its own source of truth)
 *   2. the baseline (`cv.md`)
 *   3. additional CVs, in the order this module returns them
 *
 * The rule mirrors the one career-ops already had for `article-digest.md`
 * versus `cv.md`, so there is one precedence model rather than two.
 *
 * Deliberately dependency-light: fs/path plus lib/walk-tree.mjs (the one
 * directory walker in this repository) and, for the optional `cv.sources`
 * profile key, js-yaml loaded lazily so a checkout with no node_modules still
 * resolves the `cvs/` directory.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { walkTree } from './walk-tree.mjs';
import { loadYamlSafe } from './yaml-document.mjs';
import { getProfilePath } from '../path-resolver.mjs';

/** The directory under the data root that holds additional CVs. */
export const DEFAULT_EXTRA_CV_DIR = 'cvs';

/**
 * Extensions a file may have and still be read as a CV.
 *
 * `.md` is the format `cv.md` uses and the one every parser in the project
 * understands. `.markdown` and `.txt` are the same thing under another name.
 * `.tex` is included because `modes/latex-tex.md` tailors a LaTeX CV in
 * place, so a user's `.tex` CV is a real CV, not an attachment.
 */
export const CV_SOURCE_EXTENSIONS = ['.md', '.markdown', '.txt', '.tex'];

/**
 * The profile key that lists additional CVs.
 *
 * `cv.sources`, read from `config/profile.yml`. Each entry is a path
 * relative to the data root, or an absolute path.
 */
export const CV_SOURCES_PROFILE_KEY = 'sources';

/**
 * True when `path` looks like a CV this module should read.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isCvFileName(path) {
  const ext = extname(String(path ?? '')).toLowerCase();
  return CV_SOURCE_EXTENSIONS.includes(ext);
}

/**
 * Read a YAML document with js-yaml, or return null when js-yaml is absent.
 *
 * The load itself lives in lib/yaml-document.mjs — the one module allowed to
 * call it — and it loads js-yaml lazily, so this module keeps working in a
 * checkout with no node_modules: the case a test fixture hits when it copies
 * this file standalone next to the script it exercises. A missing js-yaml
 * costs the user their `cv.sources` list, not their cvs/ directory, and the
 * caller says so in a warning.
 *
 * @param {string} text
 * @returns {{document: unknown, error: string|null}}
 */
export function parseYamlDocument(text) {
  const { document, error } = loadYamlSafe(text);
  if (error) {
    return { document: null, error: `config/profile.yml could not be parsed (${error})` };
  }
  return { document, error: null };
}

/**
 * The profile's `cv.sources` list, read from a profile file.
 *
 * @param {string} profilePath
 * @returns {{paths: string[], warning: string|null}}
 */
export function readProfileCvSources(profilePath) {
  let text;
  try {
    text = readFileSync(profilePath, 'utf-8');
  } catch (err) {
    return { paths: [], warning: `config/profile.yml could not be read (${err.message}) — additional CVs were not read` };
  }
  const { document, error } = parseYamlDocument(text);
  if (error) return { paths: [], warning: error };
  const { paths, warning } = profileCvSources(document);
  return { paths, warning };
}

/**
 * Read `cv.sources` out of a profile document.
 *
 * Returns an empty list for a missing profile, an unreadable one, or one
 * whose `cv:` block is not a mapping — a malformed profile must not take the
 * CV set down with it. The reason is returned so a caller can say so.
 *
 * @param {unknown} profile Parsed profile.yml (a mapping, or anything else)
 * @returns {{paths: string[], warning: string|null}}
 */
export function profileCvSources(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { paths: [], warning: null };
  }
  const cv = profile.cv;
  if (cv === undefined || cv === null) return { paths: [], warning: null };
  if (typeof cv !== 'object' || Array.isArray(cv)) {
    return { paths: [], warning: 'config/profile.yml: `cv:` is not a mapping — additional CVs were not read' };
  }
  const listed = cv[CV_SOURCES_PROFILE_KEY];
  if (listed === undefined || listed === null) return { paths: [], warning: null };
  if (typeof listed === 'string') return { paths: [listed], warning: null };
  if (!Array.isArray(listed)) {
    return { paths: [], warning: 'config/profile.yml: `cv.sources` is not a list — additional CVs were not read' };
  }
  const paths = [];
  for (const entry of listed) {
    if (typeof entry === 'string' && entry.trim()) paths.push(entry.trim());
  }
  return { paths, warning: null };
}

/**
 * The CV paths a profile names, resolved against the data root.
 *
 * A relative path resolves against the data root; an absolute path is taken
 * as written. A path that leaves the data root is still honoured — a user
 * may keep a CV in a synced folder — but it is reported, because a file
 * outside the data root is not covered by the updater's user-layer promise
 * and a silent read of one would look like a guarantee the system cannot keep.
 *
 * @param {string} root The data root
 * @param {string[]} paths Raw paths from `cv.sources`
 * @returns {{paths: string[], warnings: string[]}}
 */
export function resolveConfiguredCvPaths(root, paths) {
  const out = [];
  const warnings = [];
  for (const raw of paths ?? []) {
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    if (!existsSync(abs)) {
      warnings.push(`config/profile.yml: cv.sources names "${raw}", which does not exist — skipped`);
      continue;
    }
    out.push(abs);
  }
  return { paths: out, warnings };
}

/**
 * Every CV file in the additional-CV directory, in a stable order.
 *
 * Sorted by file name so the order does not depend on the filesystem's
 * readdir order, which is not sorted on every platform.
 *
 * The walk goes through lib/walk-tree.mjs rather than a local recursion: it
 * is the one walker in this repository, and it refuses to descend into a
 * nested checkout. A `cvs/` folder that happens to contain a clone of
 * something else must not feed that clone's files into an evaluation.
 *
 * Symlinks are followed, because a CV kept in a synced folder and linked
 * into `cvs/` is a natural setup — the same reason `documents/` follows them.
 *
 * @param {string} dir Absolute path to the additional-CV directory
 * @returns {string[]} Absolute paths of the CV files inside it
 */
export function listExtraCvFiles(dir) {
  if (!existsSync(dir)) return [];
  let files;
  try {
    files = walkTree(dir, { links: 'follow' });
  } catch {
    return [];
  }
  return files
    .filter((path) => isCvFileName(path))
    // The folder's own scaffold is not a CV. `cvs/README.md` is tracked and
    // explains the folder; reading it as the user's resume would put the
    // documentation's prose in front of an evaluation.
    .filter((path) => !isScaffoldFile(path))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * True when a file is the system-owned scaffold of a user-layer folder.
 *
 * `README.md` and `.gitkeep` are tracked by the repository and maintained by
 * the updater; they are never the user's content.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isScaffoldFile(path) {
  const name = basename(path);
  return name === 'README.md' || name === '.gitkeep';
}

/**
 * A short, human-readable label for a CV path.
 *
 * The label is what the model sees when a claim is attributed to a source, so
 * it has to name the file and nothing else. The path relative to the data
 * root is the most useful spelling: `cv.md`, `cvs/2024-master.md`.
 *
 * @param {string} root The data root
 * @param {string} path Absolute path
 * @returns {string}
 */
export function cvLabel(root, path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return basename(path);
  return rel.split(sep).join('/');
}

/**
 * Resolve the user's complete CV set from a data root.
 *
 * Never throws for a missing or malformed piece: a data root with one CV and
 * a broken profile still resolves to that one CV, with a warning the caller
 * can show. An evaluation that cannot run because of an unreadable profile
 * would be worse than one that runs on less information.
 *
 * @param {string} root The data root directory
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] Environment (for `CAREER_OPS_CV`)
 * @param {string} [opts.profilePath] Explicit profile path
 * @param {unknown} [opts.profile] An already-parsed profile document; when
 *   given, the profile file is not read
 * @param {boolean} [opts.includeMissing] Keep entries for files that do not
 *   exist (the fact gate wants to report them rather than silently skip them)
 * @returns {{
 *   primary: {path: string, label: string, kind: 'primary'}|null,
 *   extras: Array<{path: string, label: string, kind: 'extra', origin: 'configured'|'directory'}>,
 *   all: Array<{path: string, label: string, kind: string, origin?: string}>,
 *   extraDir: string|null,
 *   warnings: string[],
 * }}
 */
export function resolveCvSources(root, opts = {}) {
  const env = opts.env ?? process.env;
  const warnings = [];
  const dataRoot = resolve(root);

  // The baseline. `CAREER_OPS_CV` names the CV to use, which is what
  // add-entry.mjs already writes to and what export-ats-text.mjs already
  // reads; honouring it here keeps one meaning for one variable.
  const envCv = env.CAREER_OPS_CV?.trim();
  const primaryPath = envCv
    ? (isAbsolute(envCv) ? resolve(envCv) : resolve(dataRoot, envCv))
    : join(dataRoot, 'cv.md');

  let primary = null;
  if (existsSync(primaryPath)) {
    primary = { path: primaryPath, label: cvLabel(dataRoot, primaryPath), kind: 'primary' };
  } else if (envCv) {
    warnings.push(`CAREER_OPS_CV names "${envCv}", which does not exist — no CV found`);
  }

  // The profile's explicit list.
  const profilePath = opts.profilePath ?? getProfilePath(dataRoot);
  let configuredPaths = [];
  if (opts.profile !== undefined) {
    const { paths, warning } = profileCvSources(opts.profile);
    if (warning) warnings.push(warning);
    const resolved = resolveConfiguredCvPaths(dataRoot, paths);
    warnings.push(...resolved.warnings);
    configuredPaths = resolved.paths;
  } else if (existsSync(profilePath)) {
    const { paths, warning } = readProfileCvSources(profilePath);
    if (warning) warnings.push(warning);
    const resolved = resolveConfiguredCvPaths(dataRoot, paths);
    warnings.push(...resolved.warnings);
    configuredPaths = resolved.paths;
  }

  // The additional-CV directory.
  const extraDir = join(dataRoot, DEFAULT_EXTRA_CV_DIR);
  const dirPaths = listExtraCvFiles(extraDir);

  // Dedupe: a file listed in the profile AND sitting in cvs/ is one CV.
  const seen = new Set();
  const extras = [];
  const addExtra = (path, origin) => {
    const key = resolve(path);
    if (seen.has(key)) return;
    seen.add(key);
    extras.push({ path: key, label: cvLabel(dataRoot, key), kind: 'extra', origin });
  };
  for (const path of configuredPaths) addExtra(path, 'configured');
  for (const path of dirPaths) addExtra(path, 'directory');

  // The baseline is never also an extra.
  if (primary) seen.add(resolve(primary.path));
  const filteredExtras = primary ? extras.filter((e) => e.path !== primary.path) : extras;

  return {
    primary,
    extras: filteredExtras,
    all: primary ? [primary, ...filteredExtras] : filteredExtras,
    extraDir: existsSync(extraDir) ? extraDir : null,
    warnings,
  };
}

/**
 * The absolute paths of every CV, in precedence order.
 *
 * The convenience form most callers want: the fact gate, the renderer and
 * the analysis scripts all want a list of paths and nothing else.
 *
 * @param {string} root The data root directory
 * @param {object} [opts] See {@link resolveCvSources}
 * @returns {string[]}
 */
export function cvSourcePaths(root, opts = {}) {
  return resolveCvSources(root, opts).all.map((entry) => entry.path);
}

/**
 * Read every CV's text, in precedence order.
 *
 * A file that cannot be read is reported rather than thrown: a CV the user
 * cannot open should degrade the run, not end it.
 *
 * @param {string} root The data root directory
 * @param {object} [opts] See {@link resolveCvSources}
 * @returns {{documents: Array<{path: string, label: string, kind: string, content: string}>, warnings: string[]}}
 */
export function readCvSources(root, opts = {}) {
  const resolved = resolveCvSources(root, opts);
  const warnings = [...resolved.warnings];
  const documents = [];
  for (const entry of resolved.all) {
    try {
      documents.push({ ...entry, content: readFileSync(entry.path, 'utf-8') });
    } catch (err) {
      warnings.push(`${entry.label} could not be read (${err.message}) — skipped`);
    }
  }
  return { documents, warnings };
}

/**
 * The additional CVs, as one block of text with each file labelled.
 *
 * The label is what lets a model attribute a claim to the file it came from,
 * which is what the evidence rules ask for. The baseline is not included —
 * the caller already has it, and two copies of the same resume in one prompt
 * is a waste of the budget.
 *
 * @param {string} root The data root directory
 * @param {object} [opts] See {@link resolveCvSources}
 * @returns {{text: string, warnings: string[], labels: string[]}}
 */
export function joinExtraCvContents(root, opts = {}) {
  const { documents, warnings } = readCvSources(root, opts);
  const extras = documents.filter((doc) => doc.kind === 'extra');
  if (!extras.length) return { text: '', warnings, labels: [] };
  const text = extras
    .map((doc) => `--- SOURCE: ${doc.label} ---\n\n${doc.content.trim()}`)
    .join('\n\n');
  return { text, warnings, labels: extras.map((doc) => doc.label) };
}
