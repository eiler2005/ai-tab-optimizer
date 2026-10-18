"""Shared Codex invocation for short, read-only classification requests."""


def build_codex_command(binary: str, schema: str, output: str, model: str, prompt: str) -> list[str]:
    command = [binary, "exec", "--skip-git-repo-check", "--sandbox", "read-only",
               "-c", 'model_reasoning_effort="low"', "--output-schema", schema,
               "-o", output, "--color", "never"]
    if model.strip():
        command.extend(["-m", model.strip()])
    return [*command, prompt]
