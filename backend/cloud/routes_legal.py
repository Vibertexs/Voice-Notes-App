"""Serves the legal pages (see legal.py) at short, stable addresses.

The Google sign-in consent screen, the store listing and the app all link here, so these
paths should not move: /privacy, /terms, /recording-consent, /delete-account, /legal.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse

from backend.cloud import legal
from backend.cloud.deps import SettingsDep

router = APIRouter(include_in_schema=False)


def _page(settings, slug: str | None) -> HTMLResponse:
    body = legal.render(settings, slug)
    if body is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such page.")
    # Unlike the API, these are worth caching for a little while: they change rarely.
    return HTMLResponse(body, headers={"Cache-Control": "public, max-age=300"})


@router.get("/legal", response_class=HTMLResponse)
async def legal_index(settings: SettingsDep) -> HTMLResponse:
    return _page(settings, None)


@router.get("/privacy", response_class=HTMLResponse)
async def privacy(settings: SettingsDep) -> HTMLResponse:
    return _page(settings, "privacy")


@router.get("/terms", response_class=HTMLResponse)
async def terms(settings: SettingsDep) -> HTMLResponse:
    return _page(settings, "terms")


@router.get("/recording-consent", response_class=HTMLResponse)
async def recording_consent(settings: SettingsDep) -> HTMLResponse:
    return _page(settings, "recording-consent")


@router.get("/delete-account", response_class=HTMLResponse)
async def delete_account_page(settings: SettingsDep) -> HTMLResponse:
    return _page(settings, "delete-account")
