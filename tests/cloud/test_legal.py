"""The legal pages are served, say what the app actually does, and take their names from settings."""
from __future__ import annotations

import pytest

from backend.cloud import legal

SLUGS = ["privacy", "terms", "recording-consent", "delete-account"]


@pytest.mark.parametrize("slug", SLUGS)
async def test_each_page_is_served_without_signing_in(client, slug):
    response = await client.get(f"/{slug}")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/html")
    assert "<h1>" in response.text and "Ekho" in response.text
    assert "{" not in response.text.split("</style>")[1], "an unfilled placeholder"       # body, not the CSS above it


async def test_the_index_links_every_document(client):
    page = (await client.get("/legal")).text
    assert all(f'href="/{slug}"' in page for slug in SLUGS)
    assert (await client.get("/nope")).status_code in (404, 401)                            # not a legal page


async def test_the_privacy_policy_matches_what_the_app_does(client):
    text = (await client.get("/privacy")).text
    for claim in ("never leaves your phone", "do not sell", "30 days", "180 days", "MongoDB", "Amazon Web Services",
                  "Google", "Resend", "Hugging Face", "assistant", "Delete account", "children"):
        assert claim.lower() in text.lower(), claim


async def test_the_recording_notice_says_to_get_permission(client):
    text = (await client.get("/recording-consent")).text
    assert "get permission before you record" in text.lower() and "all-party" in text.lower()
    terms = (await client.get("/terms")).text
    assert "responsible for recording lawfully" in terms.lower()


def test_names_come_from_settings_and_are_escaped(app):
    settings = app.state.settings.model_copy(update={
        "legal_operator": "<b>Acme</b> LLC", "legal_contact_email": "hi@example.com", "legal_jurisdiction": "Texas, USA"})
    page = legal.render(settings, "terms")
    assert "&lt;b&gt;Acme&lt;/b&gt; LLC" in page and "<b>Acme</b>" not in page
    assert 'href="mailto:hi@example.com"' in page and "the laws of Texas, USA" in page


def test_unset_names_fall_back_to_something_honest(app):
    settings = app.state.settings.model_copy(update={"legal_operator": "", "legal_contact_email": "", "legal_jurisdiction": ""})
    page = legal.render(settings, "privacy")
    assert "The Ekho developer" in page and "store listing" in page
    assert legal.render(settings, "no-such-page") is None
