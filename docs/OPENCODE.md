# OpenCode Guide

career-ops runs on OpenCode through the same shared router the other CLI integrations use.

## How OpenCode maps to career-ops

- `AGENTS.md` is the shared instruction source.
- Root `OPENCODE.md` is the thin OpenCode wrapper that imports `AGENTS.md`.
- `.opencode/skills/career-ops/SKILL.md` is the skill entrypoint: a symlink to the canonical router at `.agents/skills/career-ops/SKILL.md`, so OpenCode and every other CLI read one file.
- `.opencode/commands/*.md` are the slash commands.
- `opencode.example.json` is the configuration to copy: the Playwright MCP server, the skills path, and the skill permission.

## Interactive OpenCode

Start OpenCode in the repository root:

```bash
cd career-ops
opencode
```

Then run a command, or paste a job URL and let the agent pick the mode.

| Command | What it does |
|---------|--------------|
| `/career-ops` | loads the career-ops skill and runs the mode you name |
| `/career-ops-interview-prep <company> <role>` | the full interview-prep package for one role |
| `/career-ops-interview-intel <company>` | shows the saved prep report for a company, without researching again |

The skill's ID is `career-ops`, derived from its path and case-sensitive. OpenCode's skill tool takes `{"id": "career-ops"}`; `{"name": ...}` is Claude Code's parameter and loads nothing here.

Browser-heavy flows — `scan`, `pipeline`, `apply` — need the Playwright MCP server configured (below).

## Configuration: `opencode.json` / `opencode.jsonc`

Copy `opencode.example.json` to `opencode.json` in the repository root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true
    }
  },
  "skills": ["./.agents/skills"],
  "permissions": [
    { "action": "skill", "resource": "*", "effect": "allow" }
  ]
}
```

- **MCP** — the browser tools that `scan`, `pipeline` and `apply` drive. Without it, those modes cannot open a posting.
- **skills** — extra directories to search for skills. `.agents/skills` is the canonical career-ops location, and it is the one to point at: the `.opencode/skills/career-ops/SKILL.md` entrypoint is a symlink to it, and on a filesystem without symlink support that entrypoint becomes a small pointer file rather than the skill.
- **permissions** — rules are ordered and the last matching rule wins, so this allows the model to load the `career-ops` skill without asking. A rule that matches nothing falls back to `ask`, and a headless run has nobody to answer.

OpenCode merges its configuration sources — the global `~/.config/opencode/opencode.json[c]`, then `$OPENCODE_CONFIG`, then the project file — so the project file wins per key. JSONC is accepted: comments and trailing commas are fine.

## Headless usage

```bash
opencode run "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
opencode run "Run the career-ops scan mode and summarize new matches."
```

`opencode run` is the headless entrypoint. When the `opencode` binary is not on PATH, the batch runner falls back to Ollama, which runs the same CLI:

```bash
ollama launch opencode -y -- run "Run the career-ops scan mode and summarize new matches."
```

Record the CLI you actually run so `doctor.mjs`, the relevance re-ranker and the web UI all use it:

```bash
node remember-cli.mjs opencode
```

That writes `CAREER_OPS_CLI=opencode` to the data root's `.env`.

## Telling `doctor.mjs` which CLI you run

```bash
node doctor.mjs --cli opencode
```

Without the flag, `doctor.mjs` resolves the CLI in this order: the `--cli` flag, then `$CAREER_OPS_CLI`, then `CAREER_OPS_CLI` in the data root's `.env`, then the runtime marker, then a checkout that holds an `opencode.json` and no Claude MCP config, then whichever other CLI is installed.

The runtime marker is `OPENCODE=1`: OpenCode stamps it on every process it runs, so a `doctor.mjs` started from inside OpenCode already knows which CLI it is in. A user who sets `OPENCODE=0` opts out and keeps the default.

## Permissions in the web UI

The web UI runs workers headlessly and applies each worker's capability record — may it write, does it need the network — to whichever CLI you picked. Claude expresses that as tool flags, Codex as an OS sandbox, and OpenCode as a **permission document**: its rules are config, not flags, and the OpenCode *server* reads them.

Two consequences shaped the implementation:

1. The document travels in `OPENCODE_CONFIG_CONTENT`, and that variable is read by the OpenCode server, not by the client. A run that attaches to an already-running shared OpenCode server therefore never sees it — with the variable set, the model's shell tool still ran and wrote its file. The web's OpenCode runs therefore pass `--standalone`, so the run gets a private server that inherits the web process's environment and does read the document.
2. The rules are ordered and the last match wins, so the fence denies everything first and then grants the actions the record needs: `read`, `glob` and `grep` always; `webfetch` and `websearch` for a worker that must reach the web; `edit` and `shell` for one that must write. Everything that has no Claude counterpart stays denied — Code Mode's `execute`, `question`, `skill`, subagents, and the MCP tools, whose names depend on servers the web cannot know in advance.

What was verified, on opencode v2.2.7: the document is loaded from `OPENCODE_CONFIG_CONTENT` by a server this process starts, and the rules it carries are appended to the list every agent enforces, so they win over the base allow policy; every tool asks permission before it runs, so a denied action never happens. The rules reach that list when the server finishes loading its configuration — about five seconds into a private server's life — while a worker's first tool call comes after its first model turn, which is later. The end-to-end refusal of one tool call was not observed here: the provider's free tier ran out mid-check, so that last link rests on the shipped code path rather than on a recorded run.

Both `--standalone` and the ordered `permissions` rules are OpenCode V2. An older CLI has neither, and its workers would fail to start rather than run unfenced.

## Troubleshooting

**The skill is not found.** The ID is `career-ops`, and it is the path-derived, case-sensitive ID of `.opencode/skills/career-ops/SKILL.md` — not the frontmatter name. Check that the file is there, and that it resolves to the canonical router (a symlink to `../../../.agents/skills/career-ops/SKILL.md`). If your checkout was made on a filesystem without symlink support, that entrypoint is a pointer file: point the `skills` array at `./.agents/skills` instead. A skill also needs a `description` to be advertised to the model.

**Playwright MCP not detected.** `node doctor.mjs --cli opencode` says which files it looked at. Add the server to the project `opencode.json`, to the global `~/.config/opencode/opencode.json[c]`, or to `$OPENCODE_CONFIG`. OpenCode merges the sources, so a project file that redefines the `playwright` server wins over the global one. `opencode mcp list` shows what the server actually loaded.

**`opencode run` has no model.** OpenCode needs a provider and a model. `opencode auth login` connects one, `opencode models` lists what is available, and `"model": "provider/model"` in the config sets the default.

**The run stops on a permission request.** A headless run has nobody to answer an `ask`, so OpenCode turns it into a denial. career-ops' own runs deny rather than ask, which is why the fence grants exactly the actions a worker needs.
