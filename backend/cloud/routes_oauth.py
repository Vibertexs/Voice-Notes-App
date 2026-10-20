"""The page an assistant sends a person to, to sign in and approve being connected.

Flow: the assistant opens /authorize (the MCP SDK validates it), which parks the
request and redirects here with its id. This page names who is asking and what they
would be allowed, and offers Google sign-in. The Google credential is bound to the
request (its nonce is the request id) and checked on the server; only an account
that already exists can approve - connecting an assistant never creates one.
Approving sends the browser back to the assistant with a one-time code.

The request id is the only thing tying this browser to the request, so it is an
unguessable value, single use, and expires in ten minutes.
"""
from __future__ import annotations

import html
import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from backend.cloud import ratelimit
from backend.cloud.deps import DatabaseDep, SettingsDep, client_ip
from backend.cloud.google import GoogleTokenError

router = APIRouter(prefix="/oauth", include_in_schema=False)

STALE = "This link has expired. Go back to the assistant and choose Connect again."


class Approve(BaseModel):
    request: str = Field(min_length=20, max_length=100)
    credential: str = Field(min_length=20, max_length=5000)


class Decline(BaseModel):
    request: str = Field(min_length=20, max_length=100)


def _provider(request: Request) -> Any:
    provider = getattr(request.app.state, "oauth", None)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assistant sign-in is not set up on this server.")
    return provider


PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Connect to Ekho</title>
<style nonce="{nonce}">
:root {{ --bg:#0A0A0D; --surface:#1E1E25; --hairline:rgba(255,255,255,.09); --text:#F4F4F6; --muted:#A3A3AE; --primary:#FF2D55; }}
@media (prefers-color-scheme: light) {{ :root {{ --bg:#F4F4F6; --surface:#FFFFFF; --hairline:rgba(0,0,0,.1); --text:#0A0A0D; --muted:#5A5A66; }} }}
* {{ box-sizing: border-box; }}
body {{ margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px; background:var(--bg); color:var(--text);
        font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }}
main {{ width:100%; max-width:420px; background:var(--surface); border:1px solid var(--hairline); border-radius:26px; padding:28px 22px; }}
.brand {{ color:var(--primary); font-weight:700; letter-spacing:.02em; margin:0 0 18px; }}
h1 {{ font-size:24px; line-height:1.2; margin:0 0 12px; }}
p {{ margin:0 0 14px; }} .muted {{ color:var(--muted); font-size:14px; }}
ul {{ margin:0 0 18px; padding-left:20px; }} li {{ margin:4px 0; }}
.actions {{ margin-top:20px; display:grid; gap:12px; justify-items:center; }}
button.deny {{ background:none; border:0; color:var(--muted); font:inherit; padding:10px; cursor:pointer; text-decoration:underline; }}
#status {{ min-height:1.4em; text-align:center; font-size:14px; }} #status.bad {{ color:var(--primary); }}
</style></head>
<body><main id="app" data-request="{request}" data-google="{google}">
<p class="brand">Ekho</p>
<h1>Connect {client} to your lectures?</h1>
<p>{client} will be able to:</p>
<ul><li>read your recording titles, folders and bookmarks</li><li>read your transcripts and notes</li><li>search them</li></ul>
<p class="muted">It cannot change or delete anything, and it never gets audio: recordings stay on your phone.
You can disconnect it any time from the app.</p>
{warning}
<div class="actions">
  <div id="google-button"></div>
  <div id="status" role="status"></div>
  <button class="deny" id="deny" type="button">Cancel</button>
</div>
<script src="https://accounts.google.com/gsi/client" async defer nonce="{nonce}"></script>
<script nonce="{nonce}">
const app = document.getElementById('app');
const request = app.dataset.request;
const statusEl = document.getElementById('status');
function say(text, bad) {{ statusEl.textContent = text; statusEl.className = bad ? 'bad' : ''; }}
async function post(path, body) {{
  const response = await fetch(path, {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify(body) }});
  const data = await response.json().catch(() => ({{}}));
  if (!response.ok) throw new Error(data.detail || 'Something went wrong. Try again.');
  return data;
}}
async function onCredential(result) {{
  say('Connecting…');
  try {{ window.location.href = (await post('/oauth/consent', {{ request, credential: result.credential }})).redirect; }}
  catch (error) {{ say(error.message, true); }}
}}
document.getElementById('deny').addEventListener('click', async () => {{
  try {{ window.location.href = (await post('/oauth/deny', {{ request }})).redirect; }}
  catch (error) {{ say(error.message, true); }}
}});
window.onload = () => {{
  if (!window.google) {{ say('Google sign-in could not load. Check your connection and reload.', true); return; }}
  google.accounts.id.initialize({{ client_id: app.dataset.google, callback: onCredential, nonce: request, ux_mode: 'popup' }});
  google.accounts.id.renderButton(document.getElementById('google-button'),
    {{ theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 }});
}};
</script></main></body></html>"""

UNVERIFIED = ('<p class="muted"><strong>{client}</strong> introduced itself to Ekho; this is not checked. '
              "After you approve you will be sent to <strong>{target}</strong>. Only continue if you just started this from {client}.</p>")

ERROR_PAGE = ('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
              '<title>Ekho</title><body style="font:16px system-ui;background:#0A0A0D;color:#F4F4F6;padding:32px 16px">'
              '<p style="color:#FF2D55;font-weight:700">Ekho</p><p>{message}</p></body>')


def render(description: dict[str, Any], google_client_id: str, nonce: str) -> str:
    client = html.escape(description["clientName"])
    warning = "" if description["verified"] else UNVERIFIED.format(
        client=client, target=html.escape(description["redirectTo"]))
    return PAGE.format(nonce=nonce, request=html.escape(description["id"]), google=html.escape(google_client_id),
                       client=client, warning=warning)


@router.get("/consent", response_class=HTMLResponse)
async def consent_page(request: Request, settings: SettingsDep, database: DatabaseDep, request_id: str = "") -> HTMLResponse:
    provider = _provider(request)
    await ratelimit.hit(database, settings, "consent:ip", client_ip(request))
    description = await provider.pending(request.query_params.get("request", "")[:100])
    if description is None:
        return HTMLResponse(ERROR_PAGE.format(message=html.escape(STALE)), status_code=400)
    if not request.app.state.google.enabled:
        return HTMLResponse(ERROR_PAGE.format(message="Sign-in is not set up on this server."), status_code=503)
    nonce = secrets.token_urlsafe(16)
    response = HTMLResponse(render(description, settings.google_client_ids[0], nonce))
    # Only what the page needs: its own inline script, and Google's sign-in button.
    response.headers["Content-Security-Policy"] = (
        f"default-src 'none'; script-src 'nonce-{nonce}' https://accounts.google.com/gsi/client; "
        f"style-src 'nonce-{nonce}' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com/gsi/; "
        "connect-src 'self' https://accounts.google.com/gsi/; img-src data: https://*.googleusercontent.com; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    return response


@router.post("/consent")
async def approve(body: Approve, request: Request, settings: SettingsDep, database: DatabaseDep) -> dict[str, str]:
    provider = _provider(request)
    await ratelimit.hit(database, settings, "consent:ip", client_ip(request))
    if await provider.pending(body.request) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, STALE)
    google = request.app.state.google
    if not google.enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in is not set up on this server.")
    try:
        # The nonce is the request id: a credential minted for some other page cannot approve this one.
        claims = await google.verify(body.credential, body.request)
    except GoogleTokenError as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(error)) from None
    user = await database.users.find_one({"googleSub": claims["sub"]}, projection={"_id": 1})
    if user is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "That Google account does not have an Ekho account yet. Open the app, sign in there, then try again.")
    redirect = await provider.approve(body.request, user["_id"])
    if redirect is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, STALE)
    return {"redirect": redirect}


@router.post("/deny")
async def decline(body: Decline, request: Request, settings: SettingsDep, database: DatabaseDep) -> dict[str, str]:
    provider = _provider(request)
    await ratelimit.hit(database, settings, "consent:ip", client_ip(request))
    redirect = await provider.deny(body.request)
    if redirect is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, STALE)
    return {"redirect": redirect}
