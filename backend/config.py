import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

EE_PROJECT = os.getenv("EE_PROJECT", "").strip()
EE_SERVICE_ACCOUNT = os.getenv("EE_SERVICE_ACCOUNT", "").strip()
EE_KEY_FILE = os.getenv("EE_KEY_FILE", "").strip()

EE_KEY_JSON = os.getenv("EE_KEY_JSON", "").strip()

# Ask Helios (AI chat). Optional: without it the chat button says the chat is off.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()

FRONTEND_DIR = ROOT / "frontend"

ALERT_MIN_FIRE_PIXELS = 1
ALERT_SO2_RATIO = 1.5
WATCH_FIRE_PIXELS = 10
WATCH_SO2_RATIO = 2.0

CACHE_SECONDS = 3600

