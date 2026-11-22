/**
 * Content-level extract/patch for user-owned LaTeX CV templates.
 * v1 families: resumeSubheading | tabularx-itemize
 */

import { escapeLatex } from './latex-escape.mjs';
import { existsSync, mkdtempSync, openSync, closeSync, lstatSync, writeFileSync, rmSync, constants as fsConstants } from 'node:fs';
const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fsConstants;
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SUPPORTED_FAMILIES = ['resumeSubheading', 'tabularx-itemize'];

export const UNSUPPORTED_HINT =
  'Unsupported LaTeX CV layout. v1 supports \\resumeSubheading + \\resumeItem macros, ' +
  'or tabularx + itemize without resume macros. Use /career-ops latex (cv.md → career-ops template) instead.';

/**
 * @param {string} tex
 * @returns {number}
 */
export function findMatchingBrace(tex, openIdx) {
  if (tex[openIdx] !== '{') return -1;
  let depth = 0;
  let escaped = false;
  let inComment = false;
  for (let i = openIdx; i < tex.length; i++) {
    const ch = tex[i];
    // L1: an unescaped `%` starts a comment that runs to the end of the LINE.
    // A `}` inside it is a comment character, not the brace closing this slot.
    // Treating it as the close left the real closing brace as stray text and
    // broke compilation. The escape rule is the one isCommentedAt() uses, so
    // `\%` stays a literal percent and does not start a comment.
    if (ch === '\n') {
      inComment = false;
      escaped = false;
      continue;
    }
    if (inComment) continue;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '%') {
      inComment = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {string} tex
 * @returns {'resumeSubheading'|'tabularx-itemize'|null}
 */
export function detectFamily(tex) {
  if (typeof tex !== 'string' || !tex.trim()) return null;
  if (/\\resumeSubheading\b/.test(tex) && /\\(resumeItem|resumeItemWithoutTitle|resumeSubItem)\b/.test(tex)) {
    return 'resumeSubheading';
  }
  const hasTabularx = /\\usepackage\{[^}]*tabularx[^}]*\}/.test(tex) || /\\begin\{tabularx\}/.test(tex);
  const hasItemize = /\\begin\{itemize\}/.test(tex);
  if (hasTabularx && hasItemize && !/\\resumeSubheading\b/.test(tex)) {
    return 'tabularx-itemize';
  }
  return null;
}

/**
 * Index where the document body starts, so extraction can skip macro
 * definitions in the preamble (e.g. `\newcommand{\resumeSubItem}[2]{\resumeItem{#1}{#2}}`
 * would otherwise be captured as a `#1` slot).
 *
 * @param {string} tex
 * @returns {number}
 */
function bodyStart(tex) {
  const docStart = tex.indexOf('\\begin{document}');
  return docStart === -1 ? 0 : docStart;
}

/**
 * True when `idx` sits on a line that is commented out at that position —
 * i.e. an unescaped `%` appears earlier on the same line. Commented macro
 * calls are inert LaTeX (often old bullets kept for reference) and must not
 * become editable slots.
 *
 * @param {string} tex
 * @param {number} idx
 * @returns {boolean}
 */
function isCommentedAt(tex, idx) {
  const lineStart = tex.lastIndexOf('\n', idx - 1) + 1;
  for (let i = lineStart; i < idx; i++) {
    if (tex[i] === '\\') {
      i++; // skip escaped char (\% is a literal percent)
      continue;
    }
    if (tex[i] === '%') return true;
  }
  return false;
}

/**
 * Extract macro argument bodies as editable slots. Spans are absolute
 * offsets into `tex`; scanning starts at the document body.
 *
 * `useNextGroupIfEmpty` handles the common `\resumeItemWithoutTitle{}{Text}`
 * pattern (one-parameter macro called with an empty first group followed by a
 * plain braced group): when the captured group is empty/whitespace, the slot
 * points at the immediately following braced group instead.
 *
 * @param {string} tex
 * @param {string} macroName
 * @param {string} kind
 * @param {{useNextGroupIfEmpty?: boolean}} [opts]
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractMacroBodies(tex, macroName, kind, { useNextGroupIfEmpty = false } = {}) {
  const slots = [];
  const needle = `\\${macroName}{`;
  let searchFrom = bodyStart(tex);
  while (searchFrom < tex.length) {
    const idx = tex.indexOf(needle, searchFrom);
    if (idx === -1) break;
    if (isCommentedAt(tex, idx)) {
      searchFrom = idx + needle.length;
      continue;
    }
    const openBrace = idx + needle.length - 1;
    const closeBrace = findMatchingBrace(tex, openBrace);
    if (closeBrace === -1) break;
    let innerStart = openBrace + 1;
    let innerEnd = closeBrace;
    searchFrom = closeBrace + 1;

    if (useNextGroupIfEmpty && !tex.slice(innerStart, innerEnd).trim()) {
      let cursor = closeBrace + 1;
      while (cursor < tex.length && /\s/.test(tex[cursor])) cursor++;
      if (tex[cursor] !== '{') continue; // empty group with no follow-up group — nothing editable
      const openNext = cursor;
      const closeNext = findMatchingBrace(tex, openNext);
      if (closeNext === -1) break;
      innerStart = openNext + 1;
      innerEnd = closeNext;
      searchFrom = closeNext + 1;
    }

    slots.push({
      id: `${kind}-${slots.length}`,
      kind,
      text: tex.slice(innerStart, innerEnd),
      span: { start: innerStart, end: innerEnd },
    });
  }
  return slots;
}

/**
 * Extract the value argument of `\resumeSubItem{Category}{Items}` calls as
 * skill slots. The category (first group) is left untouched; only the second
 * group is editable.
 *
 * @param {string} tex
 * @returns {Array<{kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractSubItemValues(tex) {
  const slots = [];
  const needle = '\\resumeSubItem{';
  let searchFrom = bodyStart(tex);
  while (searchFrom < tex.length) {
    const idx = tex.indexOf(needle, searchFrom);
    if (idx === -1) break;
    if (isCommentedAt(tex, idx)) {
      searchFrom = idx + needle.length;
      continue;
    }
    const openCat = idx + needle.length - 1;
    const closeCat = findMatchingBrace(tex, openCat);
    if (closeCat === -1) break;
    searchFrom = closeCat + 1;

    let cursor = closeCat + 1;
    while (cursor < tex.length && /\s/.test(tex[cursor])) cursor++;
    if (tex[cursor] !== '{') continue;
    const openVal = cursor;
    const closeVal = findMatchingBrace(tex, openVal);
    if (closeVal === -1) break;

    slots.push({
      kind: 'skill',
      text: tex.slice(openVal + 1, closeVal),
      span: { start: openVal + 1, end: closeVal },
    });
    searchFrom = closeVal + 1;
  }
  return slots;
}

/**
 * @param {string} tex
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractSkillValues(tex) {
  const slots = [];
  let searchFrom = bodyStart(tex);
  while (searchFrom < tex.length) {
    const idx = tex.indexOf('\\textbf{', searchFrom);
    if (idx === -1) break;
    if (isCommentedAt(tex, idx)) {
      searchFrom = idx + 8;
      continue;
    }
    const openCat = tex.indexOf('{', idx);
    const closeCat = findMatchingBrace(tex, openCat);
    if (closeCat === -1) break;

    let cursor = closeCat + 1;
    while (cursor < tex.length && /\s/.test(tex[cursor])) cursor++;
    if (tex[cursor] !== '{') {
      searchFrom = closeCat + 1;
      continue;
    }

    const openVal = cursor;
    const closeVal = findMatchingBrace(tex, openVal);
    if (closeVal === -1) break;

    const rawValue = tex.slice(openVal + 1, closeVal);
    const colon = rawValue.match(/^:\s*/);
    if (!colon) {
      searchFrom = closeVal + 1;
      continue;
    }

    const itemsStart = openVal + 1 + colon[0].length;
    const itemsText = tex.slice(itemsStart, closeVal);
    slots.push({
      kind: 'skill',
      text: itemsText,
      span: { start: itemsStart, end: closeVal },
    });
    searchFrom = closeVal + 1;
  }
  return slots;
}

/**
 * @param {string} tex
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractItemizeItems(tex) {
  const docStart = tex.indexOf('\\begin{document}');
  const body = docStart === -1 ? tex : tex.slice(docStart);
  const offset = docStart === -1 ? 0 : docStart;
  const slots = [];
  const itemRe = /\\item\b/g;
  let match;
  while ((match = itemRe.exec(body)) !== null) {
    if (isCommentedAt(body, match.index)) continue;
    let i = match.index + match[0].length;
    while (i < body.length && /\s/.test(body[i])) i++;

    if (body[i] === '{') {
      const openBrace = i;
      const closeBrace = findMatchingBrace(body, openBrace);
      if (closeBrace === -1) continue;
      slots.push({
        id: `item-${slots.length}`,
        kind: 'item',
        text: body.slice(openBrace + 1, closeBrace),
        span: { start: offset + openBrace + 1, end: offset + closeBrace },
      });
      continue;
    }

    const lineEnd = body.indexOf('\n', i);
    const end = lineEnd === -1 ? body.length : lineEnd;
    const text = body.slice(i, end).trim();
    if (!text) continue;
    slots.push({
      id: `item-${slots.length}`,
      kind: 'item',
      text,
      span: { start: offset + i, end: offset + end },
    });
  }
  return slots;
}

/**
 * @param {string} tex
 * @param {'resumeSubheading'|'tabularx-itemize'} family
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
export function extractSlots(tex, family) {
  if (family === 'resumeSubheading') {
    const byPosition = (a, b) => a.span.start - b.span.start;
    const dedupe = (list) => {
      const seen = new Set();
      return list.filter(s => {
        const key = `${s.span.start}-${s.span.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const bullets = dedupe([
      ...extractMacroBodies(tex, 'resumeItem', 'bullet'),
      ...extractMacroBodies(tex, 'resumeItemWithoutTitle', 'bullet', { useNextGroupIfEmpty: true }),
    ].sort(byPosition)).map((s, i) => ({ ...s, id: `bullet-${i}` }));
    const skills = dedupe([
      ...extractSkillValues(tex),
      ...extractSubItemValues(tex),
    ].sort(byPosition)).map((s, i) => ({ ...s, id: `skill-${i}` }));
    return [...bullets, ...skills];
  }
  if (family === 'tabularx-itemize') {
    return extractItemizeItems(tex);
  }
  return [];
}

/**
 * @param {string} texPath
 * @param {string} tex
 * @returns {{supported: boolean, family: string|null, source: string, slots: Array, error?: string, hint?: string}}
 */
export function buildManifest(texPath, tex) {
  const family = detectFamily(tex);
  if (!family) {
    return {
      supported: false,
      family: null,
      source: texPath,
      slots: [],
      error: UNSUPPORTED_HINT,
      hint: 'Place resume.tex in the project root or set latex.source in config/profile.yml.',
    };
  }

  const slots = extractSlots(tex, family);
  return {
    supported: true,
    family,
    source: texPath,
    slots,
  };
}

/**
 * @param {string} tex
 * @param {Array<{id: string, text: string}>} patches
 * @param {Array<{id: string, span: {start: number, end: number}}>} slots
 * @param {{escape?: boolean}} [opts]
 * @returns {string}
 */
export function applyPatches(tex, patches, slots, { escape = true } = {}) {
  const seen = new Set();
  for (const patch of patches) {
    if (seen.has(patch.id)) throw new Error(`Duplicate patch id: ${patch.id}`);
    seen.add(patch.id);
  }
  const slotById = new Map(slots.map(s => [s.id, s]));
  const ordered = [...patches]
    .map(p => {
      const slot = slotById.get(p.id);
      if (!slot) return null;
      return { slot, text: p.text };
    })
    .filter(Boolean)
    .sort((a, b) => b.slot.span.start - a.slot.span.start);

  let out = tex;
  for (const { slot, text } of ordered) {
    const replacement = escape ? escapeLatex(text) : text;
    out = out.slice(0, slot.span.start) + replacement + out.slice(slot.span.end);
  }
  return out;
}

// ── P14: secure temp files ────────────────────────────────────────────
// Predictable /tmp/cv-{candidate}-{company}.json paths hold full CV PII and a
// pre-created symlink redirects a read or write. Callers must never embed a
// candidate or company name in a temp path: a fresh 0700 directory with a
// random name holds a random 0600 file, opened O_EXCL|O_NOFOLLOW so an existing
// symlink is refused rather than followed.
export function createSecureTempFile({ prefix = 'career-ops-', suffix = '', contents = '' } = {}) {
  const base = existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir();
  const dir = mkdtempSync(join(base, prefix)); // mode 0700
  const path = join(dir, `${randomUUID()}${suffix}`);
  const fd = openSync(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
      throw new Error(`Refusing to use an insecure temp file: ${path}`);
    }
    writeFileSync(fd, contents);
  } finally {
    closeSync(fd);
  }
  return { path, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── P13: locked sections on the LaTeX path ────────────────────────────
// The HTML path refuses to render when a section declared in
// cv.locked_sections was reordered or paraphrased. The LaTeX paths had no such
// guard. Mirror the HTML semantics: locate each locked section in BOTH cv.md
// and the .tex, compare their normalized bodies, and fail closed on a
// mismatch. Content is never rewritten, only checked.
const LATEX_SECTION_RE = /\\section\*?\{([^}]*)\}/g;
const LOCAL_SECTION_ALIASES = new Map([
  ['professional experience', 'experience'], ['work experience', 'experience'],
  ['employment history', 'experience'], ['work history', 'experience'],
  ['relevant experience', 'experience'], ['education & certifications', 'education'],
  ['education and certifications', 'education'], ['formation', 'education'],
  ['educación', 'education'], ['compétences', 'skills'], ['habilidades', 'skills'],
  ['projets', 'projects'], ['proyectos', 'projects'], ['awards & honors', 'awards'],
]);

/** Canonical key for a section heading, mirroring generate-pdf.mjs's sectionKey. */
export function latexSectionKey(text) {
  const key = String(text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return LOCAL_SECTION_ALIASES.get(key) ?? key;
}

function normalizeLockText(text) {
  return String(text ?? '')
    .replace(/\\(?:begin|end)\s*\{document\}/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[#*`_~|•·]/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const LOCK_STRUCTURAL_TOKENS = new Set(['begin', 'end', 'document']);
const lockTokens = text => normalizeLockText(text).split(/\s+/)
  .filter(token => token && !LOCK_STRUCTURAL_TOKENS.has(token)).sort();

/** Ordered bullets of a section, so a reorder is caught even across formats. */
function sectionBullets(body, isLatex) {
  const out = [];
  if (isLatex) {
    for (const match of body.matchAll(/\\resumeItem(?:WithoutTitle)?\{([^{}]*)\}/g)) out.push(normalizeLockText(match[1]));
    for (const line of body.split('\n')) {
      const match = line.match(/^\s*\\item\s+(.+)$/);
      if (match) out.push(normalizeLockText(match[1]));
    }
  } else {
    for (const line of body.split('\n')) {
      const match = line.match(/^\s*[-*+]\s+(.+)$/);
      if (match) out.push(normalizeLockText(match[1]));
    }
  }
  return out.filter(Boolean);
}

function sectionBodies(tex, isLatex) {
  const lines = String(tex ?? '').replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  if (isLatex) {
    const source = String(tex ?? '');
    for (const match of source.matchAll(LATEX_SECTION_RE)) {
      headings.push({ index: source.slice(0, match.index).split('\n').length - 1, level: 1, key: latexSectionKey(match[1]) });
    }
  } else {
    lines.forEach((line, index) => {
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) headings.push({ index, level: heading[1].length, key: latexSectionKey(heading[2]) });
    });
  }
  const map = new Map();
  const levels = new Map();
  headings.forEach((heading, i) => {
    if (levels.has(heading.key) && levels.get(heading.key) <= heading.level) return;
    const next = headings.slice(i + 1).find(other => other.level <= heading.level);
    const end = next ? next.index : lines.length;
    const body = lines.slice(heading.index + 1, end).join('\n');
    map.set(heading.key, body);
    levels.set(heading.key, heading.level);
  });
  return map;
}

function lockExcerpt(value) {
  return value.length <= 120 ? value : `${value.slice(0, 117)}…`;
}

/**
 * Throw when a configured locked section's content differs between cv.md and
 * the compiled .tex. `lockedKeys` are already folded through latexSectionKey.
 */
export function validateLatexLockedSections(tex, cvMarkdown, lockedKeys) {
  if (!lockedKeys || lockedKeys.length === 0) return;
  const source = sectionBodies(cvMarkdown, false);
  const rendered = sectionBodies(tex, true);
  for (const key of lockedKeys) {
    if (!source.has(key)) {
      throw new Error(`Configured locked_section '${key}' not found in cv.md. Available sections: ${[...source.keys()].map(k => `'${k}'`).join(', ')}`);
    }
    const fromSource = source.get(key) ?? '';
    const fromTex = rendered.get(key) ?? '';
    // LaTeX orders a job's fields differently from cv.md, so compare the
    // section's CONTENT as a token bag and its bullets as an ordered list. A
    // paraphrase changes a token; a reorder changes the bullet sequence.
    if (JSON.stringify(lockTokens(fromSource)) !== JSON.stringify(lockTokens(fromTex))) {
      throw new Error(`Locked section '${key}' was modified during tailoring.\nExpected (normalized): ${lockExcerpt(normalizeLockText(fromSource))}\nFound (normalized): ${lockExcerpt(normalizeLockText(fromTex))}`);
    }
    const sourceBullets = sectionBullets(fromSource, false);
    const texBullets = sectionBullets(fromTex, true);
    if (JSON.stringify(sourceBullets) !== JSON.stringify(texBullets)) {
      throw new Error(`Locked section '${key}' was reordered during tailoring.\nExpected bullets: ${sourceBullets.join(' | ')}\nFound bullets: ${texBullets.join(' | ')}`);
    }
  }
}
