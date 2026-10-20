"""Ekho cloud API: accounts, sync and search, backed by MongoDB.

It is multi-user and never receives audio at all. Phones keep their own SQLite
as the source of truth for what they recorded, and send transcripts and metadata
here so they survive a lost phone and can be searched from elsewhere (and read by
AI assistants the person connects, over MCP).

Run it with `uvicorn cloud_app:app`. See docs/cloud-api.md.
"""
