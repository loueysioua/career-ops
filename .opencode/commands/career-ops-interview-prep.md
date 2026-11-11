---
name: career-ops-interview-prep
description: Full interview prep package for a specific company and role
---

# Run Full Interview Prep

Run full interview prep for the following company and role:

$ARGUMENTS

Load the career-ops skill:

```javascript
skill({ id: "career-ops" })
```

The skill id is the path-derived one (`career-ops`, from `.opencode/skills/career-ops/SKILL.md`); OpenCode selects skills by ID, and the ID is case-sensitive.

Then run the `interview-prep` mode for that company and role. It saves the report to `interview-prep/{company-slug}-{role-slug}.md` under the data root; `/career-ops-interview-intel` shows a saved one without researching again.
