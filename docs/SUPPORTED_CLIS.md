# Supported CLIs

Career-ops is AI-agnostic and runs on several command-line agent tools. The core logic is shared via `AGENTS.md`, while CLI-specific nuances are handled through entry wrappers in the repository root.

| CLI | Entry File | How to Invoke |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` | Interactive: `claude` (then `/career-ops`). Headless/Batch: `claude -p "prompt"`. From any folder: install the plugin ([CLAUDE_PLUGIN.md](CLAUDE_PLUGIN.md)) |
| Cursor | `AGENTS.md` | Interactive: open the project in Cursor and ask for `career-ops` (auto-discovered from `.agents/skills/career-ops/SKILL.md`) |
| Codex | `CODEX.md` (see [`docs/CODEX.md`](CODEX.md)) | Interactive: `codex` (then use plain text). Headless/Batch: `codex exec "prompt"` |
| OpenCode | `OPENCODE.md` (see [`docs/OPENCODE.md`](OPENCODE.md)) | Interactive: `opencode` (then `/career-ops`). Headless/Batch: `opencode run "prompt"` |
| Pi | `AGENTS.md` | Interactive: `pi` (then `/skill:career-ops`). Headless/Batch: `pi -a -p "prompt"` |
| Antigravity CLI | `AGENTS.md` | Interactive: `agy` (then `/career-ops`). Headless/Batch: `agy -p "prompt"` |
| Grok Build CLI | `AGENTS.md` | Interactive: `grok` (then `/career-ops`). Headless/Batch: `grok -p "prompt"` (add `--yolo` to auto-approve tool executions) |
| Qwen | `AGENTS.md` | Interactive: `qwen`. Headless/Batch: `qwen -p "prompt"` |
| Kimi | `KIMI.md` | Interactive: `kimi` |
| GitHub Copilot CLI | `AGENTS.md` | Headless/Batch: `copilot -p "prompt"` |
| Gemini | `GEMINI.md` | Legacy wrapper redirecting to `AGENTS.md` (transitioned to Antigravity CLI). |
| Hermes Agent | `AGENTS.md` | Interactive: `hermes` (then ask for a career-ops task). Web read-only workers: `hermes chat -q "prompt" --oneshot -Q --no-restore-cwd`. Batch ranking: unsupported. |
| Oh My Pi | `.omp/AGENTS.md` | Interactive: `omp` (then `/skill:career-ops`). Headless/Batch: `omp -p "prompt"` |

## Hermes Agent

Hermes runs the same pipeline as every other CLI here. Trust the checkout once with `hermes skills trust` before interactive use. The web UI uses Hermes's one-shot mode (`hermes chat -q ... --oneshot -Q --no-restore-cwd`) only for explicitly non-writing workers; evaluation and portal-repair workers reject it because no verified Hermes permission adapter exists. Batch ranking does not support Hermes. Hermes project-context scanning still applies; see [`docs/HERMES.md`](HERMES.md) for its rules and limitations.

## OpenCode

OpenCode reads `AGENTS.md` as project context through `OPENCODE.md`, and finds the shared router at `.opencode/skills/career-ops/SKILL.md`. The slash command `/career-ops` loads it **by its path-derived ID** — `career-ops` — because OpenCode's `skill` tool takes `{"id": "..."}`; `name` is Claude Code's parameter and does not select a skill here.

```bash
cd career-ops
opencode                                       # interactive, then /career-ops
opencode run "Evaluate this JD: https://company.com/jobs/123"   # headless
```

`opencode run` needs a model configured in `opencode.json` (or your global config), and `opencode` stamps `OPENCODE=1` on the processes it runs, which `doctor.mjs` uses to detect the CLI on its own. See [`docs/OPENCODE.md`](OPENCODE.md) for the MCP setup, the permission rules, and troubleshooting.

## Pi

Pi needs no wrapper file: it reads `AGENTS.md` from the working directory as project context, and it discovers the shared skill at `.agents/skills/career-ops/SKILL.md` on its own. In interactive mode the router is available as `/skill:career-ops`; `--skill <path>` loads it explicitly, and `-p` runs one headless prompt. If a Pi build gates project resources behind a trust decision, interactive usage can use `/trust` and restart `pi`, while a headless invocation that needs to trust project resources should use the `-a` option.

```bash
cd career-ops
pi                                          # interactive
pi -a -p "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
```

If a Pi build gates project resources behind a trust decision, run `/trust` once inside the repo and restart `pi` so the project skill loads (`/trust` applies to future Pi processes), or start with `-a`, which trusts a single run and needs no restart.

Project trust, and with it `-a` (`--approve`), arrived in Pi 0.79.0. Pi 0.54.0 to 0.78.x has no trust step and finds the project skill without one, but it rejects the flag (`Error: Unknown option: -a`) and exits, so run it there as `pi -p "prompt"`. A Pi older than 0.54.0 does not look in `.agents/skills` at all, so upgrade it. The Nix dev shell (`flake.nix`) pins a newer Pi.

## Oh My Pi (omp)

Oh My Pi discovers `.agents/skills/career-ops/SKILL.md` automatically via its `agents` discovery provider, exposing `/skill:career-ops`. `.omp/AGENTS.md` imports `AGENTS.md` (`@../AGENTS.md`), ensuring OMP's `native` project-context provider (priority 100) wins over `.github/copilot-instructions.md` (priority 30) so the career-ops contract is loaded and respected.

```bash
cd career-ops
omp                                          # interactive
omp -p "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
```
