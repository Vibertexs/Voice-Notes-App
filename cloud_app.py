"""Entry point for the VoiceFlow cloud API.

    uvicorn cloud_app:app --reload          # development, reads .env

The desktop app is a different server (app.py); this one is the multi-user
service the phones sync with. See docs/cloud-api.md.
"""
import logging

from backend.cloud.app import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()
