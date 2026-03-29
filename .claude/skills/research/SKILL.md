---
name: research
description: Deep-research a codebase topic — reads all relevant files and writes a structured findings document
disable-model-invocation: true
---

Deep-research the topic: $ARGUMENTS

Steps:
1. Read PROJECT.md, MVP_FEATURES.md, and any other relevant project docs for context
2. Read all source files related to the topic — types, components, utils, service worker
3. Trace the data flow and identify all dependencies
4. Read docs/templates/research.md for the output format
5. Create a research document at docs/research/<topic-slug>.md following the template
6. Include: current implementation details with file paths, relevant types, dependencies, potential issues, external references

Do NOT write any code. Only research and document findings.
