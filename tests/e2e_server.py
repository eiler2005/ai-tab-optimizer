"""Isolated real server for Chromium integration tests; never opens the user's SQLite."""
import os
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import agent

agent.DB_PATH = Path(os.environ['AITAB_E2E_DB'])
uvicorn.run(agent.app, host='127.0.0.1', port=int(os.environ['AITAB_E2E_PORT']), log_level='warning')
