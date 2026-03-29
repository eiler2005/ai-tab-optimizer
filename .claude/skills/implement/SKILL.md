---
name: implement
description: Execute an approved implementation plan task by task — typecheck after each step, mark tasks done
disable-model-invocation: true
---

Implement the plan from: $ARGUMENTS

Steps:
1. Read the plan file specified above (e.g., docs/plans/<feature>.md)
2. Execute each task in the order listed in the plan
3. After completing each task:
   - Run `cd extension && pnpm typecheck` to verify no type errors introduced
   - Mark the task as completed in the plan file: change `- [ ]` to `- [x]`
4. Do NOT stop until ALL tasks in the plan are completed and marked
5. Do NOT add unnecessary comments or JSDoc
6. Do NOT use `any` type — use `unknown` with narrowing if needed
7. Follow existing patterns in the codebase (Zustand store, discriminated unions, Tailwind classes)
8. When done, update the plan Status to `done`
