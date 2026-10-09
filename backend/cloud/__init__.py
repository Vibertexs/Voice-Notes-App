"""VoiceFlow cloud API: accounts, sync and search, backed by MongoDB.

This is a separate application from the desktop server in `app.py`. The
desktop server is single-user, keeps SQLite and transcribes uploaded audio;
this one is multi-user and never receives audio at all. Phones keep their own
SQLite as the source of truth for what they recorded, and send transcripts and
metadata here so they survive a lost phone and can be searched from elsewhere.

Run it with `uvicorn cloud_app:app`. See docs/cloud-api.md.
"""
