import * as yaml from 'js-yaml';

/**
 * lib/yaml-document.mjs — the one place in this repository that reads YAML.
 *
 * Two jobs. It wraps js-yaml so an empty or comment-only document is an empty
 * document (null) instead of the exception js-yaml 5 raises on it, and it is
 * the only module allowed to call the loader — a rule the
 * `no shipped script calls js-yaml load directly` test enforces, because the
 * wrapper is where that behaviour lives.
 *
 * The js-yaml import is a static ESM one, so a YAMLException thrown by
 * malformed YAML is the same class the caller sees from `import ... from
 * 'js-yaml'` — a CJS build of the library would raise a structurally identical
 * error with a different prototype, and `instanceof YAMLException` would be
 * false for it.
 *
 * The consequence is that this module cannot be LOADED without node_modules.
 * A script that must run in a checkout with no install therefore imports it
 * dynamically, inside a try (doctor.mjs does), so the missing dependency is
 * reported in the terms a user can act on instead of arriving as
 * ERR_MODULE_NOT_FOUND at module load.
 */

/**
 * True when `text` holds anything besides blank lines and comments.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasYamlContent(text) {
  return String(text ?? '').split('\n').some((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('#');
  });
}

/**
 * Parse one YAML document. Empty and comment-only text is an empty document
 * and yields null, as it did on js-yaml 4; js-yaml 5 throws on it instead.
 * Malformed YAML still throws.
 *
 * @param {string} text
 * @param {import('js-yaml').LoadOptions} [options]
 * @returns {unknown}
 */
export function loadYaml(text, options) {
  return hasYamlContent(text) ? yaml.load(String(text), options) : null;
}

/**
 * Parse one YAML document, reporting a failure instead of throwing.
 *
 * For a caller that must degrade rather than die: a profile that cannot be
 * parsed costs the caller its `cv.sources` list, and the caller says so in a
 * warning instead of taking the whole run down.
 *
 * @param {string} text
 * @param {import('js-yaml').LoadOptions} [options]
 * @returns {{document: unknown, error: string|null}}
 */
export function loadYamlSafe(text, options) {
  try {
    return { document: loadYaml(text, options), error: null };
  } catch (err) {
    return { document: null, error: err?.message ?? String(err) };
  }
}
