# cvs/ — your additional CVs

Drop every other CV you have here, one file per CV, and career-ops reads them
all. A candidate may hold more than one: a long master CV, a one-page version,
a variant aimed at another market, or an older draft that still holds a
detail the newer one dropped. Evaluations are then scored against your whole
record instead of a fraction of it.

| File | What it is |
|---|---|
| `master.md` | A long master CV — everything, in one place |
| `short.md` | The one-page version |
| `market-<x>.md` | A variant for another market or language |

Formats: `.md`, `.markdown`, `.txt`, `.tex`. Subfolders work too
(`cvs/2024/master.md`).

## `cv.md` stays the baseline

`cv.md` at the data root is still the CV a tailored CV is **cut from**, and
its section order is what the renderer validates against. The files here are
**evidence**: a role, metric, certification or project that appears only in
one of them is still yours, and career-ops may use it — but it never changes
the baseline's structure, and it never becomes the thing a tailored CV is
built from.

When two files disagree about a fact, `article-digest.md` wins, then `cv.md`,
then the files here. When two of your CVs disagree and `cv.md` does not settle
it, career-ops asks you rather than picking the flattering one.

## Keeping a CV somewhere else

CVs kept outside this folder (a synced folder, a shared drive) can be listed
in `config/profile.yml`:

```yaml
cv:
  sources:
    - ~/Documents/cv/short-version.md
```

Listing is also how you state precedence: a file listed there outranks one
merely found in this folder.

The `/career-ops intake` mode can move a CV here for you — say "keep this as
an extra CV" and it writes it into this folder as markdown, confirmed first.

Your CVs here are **user layer**: gitignored, never touched by the updater,
never leaving your machine. `README.md` and `.gitkeep` are the system-owned
scaffold for the folder — they are tracked, and the updater does maintain
them.

See `modes/_shared.md` → "Multiple CVs" for the full rule, and
`lib/cv-sources.mjs` for how the set is resolved.
