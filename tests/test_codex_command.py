from server_core.codex_command import build_codex_command


def test_classifier_uses_read_only_sandbox_low_reasoning_and_literal_prompt():
    prompt = 'Untrusted title: $(touch /tmp/do-not-execute)'
    command = build_codex_command('/tmp/codex', '/tmp/schema.json', '/tmp/output.txt', ' gpt-5.6-terra ', prompt)
    assert command[command.index('--sandbox') + 1] == 'read-only'
    assert 'model_reasoning_effort="low"' in command
    assert command[command.index('-m') + 1] == 'gpt-5.6-terra'
    assert command[-1] == prompt


def test_empty_model_uses_cli_default():
    assert '-m' not in build_codex_command('codex', 'schema', 'output', ' ', 'prompt')
