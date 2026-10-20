"""Entry point for the Ekho cloud API.

    uvicorn cloud_app:app --reload          # development, reads .env

This is the multi-user service the phones sync with. See docs/cloud-api.md.
"""
import logging

from backend.cloud.app import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()
