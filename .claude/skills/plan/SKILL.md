---
name: plan
description: Create an implementation plan for a feature — reads sources, outputs a structured plan with task checklist
disable-model-invocation: true
---

Create an implementation plan for: $ARGUMENTS

Steps:
1. Check if a research document exists in docs/research/ for this topic — read it if so
2. Read PROJECT.md and MVP_FEATURES.md for product context
3. Read all relevant source files to understand current implementation
4. Read docs/templates/plan.md for the output format
5. Create a plan document at docs/plans/<feature-slug>.md following the template
6. Include: specific file paths, code snippets, task checklist with `- [ ]` markers, trade-offs, testing strategy
7. Share reference implementations from existing code when relevant

Do NOT write any implementation code. Only create the plan document.
Wait for the user to review, annotate, and approve the plan before implementing.
