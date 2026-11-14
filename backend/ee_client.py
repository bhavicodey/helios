import json

import ee

from . import config

_ready = False


class EENotReady(RuntimeError):
    """Raised with a human-readable message when Earth Engine can't start."""


def ensure() -> None:
    global _ready
    if _ready:
        return
    if not config.EE_PROJECT or config.EE_PROJECT == "your-gcp-project-id":
        raise EENotReady("Set EE_PROJECT in the .env file to your Google Cloud project ID, then restart.")
    try:
        if config.EE_KEY_JSON:                          # hosted: key pasted into an environment variable
            try:
                email = config.EE_SERVICE_ACCOUNT or json.loads(config.EE_KEY_JSON)["client_email"]
            except (ValueError, KeyError) as exc:
                raise EENotReady("EE_KEY_JSON is not a valid service-account key. Paste the whole downloaded .json file.") from exc
            creds = ee.ServiceAccountCredentials(email, key_data=config.EE_KEY_JSON)
            ee.Initialize(creds, project=config.EE_PROJECT)
        elif config.EE_SERVICE_ACCOUNT and config.EE_KEY_FILE:
            creds = ee.ServiceAccountCredentials(config.EE_SERVICE_ACCOUNT, config.EE_KEY_FILE)
            ee.Initialize(creds, project=config.EE_PROJECT)
        else:
            ee.Initialize(project=config.EE_PROJECT)
    except EENotReady:
        raise
    except Exception as exc:  # noqa: BLE001
        hint = ("Check that EE_KEY_JSON is the full key, the service account is registered for Earth Engine, "
                "and it has the 'Earth Engine Resource Viewer' and 'Service Usage Consumer' roles in this project."
                if config.EE_KEY_JSON else
                "Run `earthengine authenticate` in the terminal, and check that your project is registered for Earth Engine.")
        # with a pasted key, Earth Engine's own error text can contain the key itself, so it is never shown
        detail = type(exc).__name__ if config.EE_KEY_JSON else str(exc)
        raise EENotReady(f"Earth Engine could not start ({detail}). {hint}") from None
    _ready = True
