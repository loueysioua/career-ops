---
name: career-ops-interview-intel
description: Show the saved interview prep report for a company
---

# Show Saved Interview Prep

Show the interview prep report already saved for the following company:

$ARGUMENTS

Load the career-ops skill:

```javascript
skill({ id: "career-ops" })
```

The skill id is the path-derived one (`career-ops`, from `.opencode/skills/career-ops/SKILL.md`); OpenCode selects skills by ID, and the ID is case-sensitive.

Then read the matching `interview-prep/{company}-{role}.md` under the data root (the report the `interview-prep` mode writes) and show it. Do not research or write a new one. If no report exists for that company, say so and offer to run `/career-ops interview-prep` for it.
