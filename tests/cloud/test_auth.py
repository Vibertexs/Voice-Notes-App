"""Accounts: sign-up, sign-in, tokens, resets, Apple, deletion."""
from __future__ import annotations

import re
from datetime import timedelta

import jwt
import pytest

from backend.cloud import accounts
from backend.cloud.common import utcnow
from tests.cloud.conftest import Account, unique_id


# ---------------------------------------------------------------------------
# Register and log in
# ---------------------------------------------------------------------------

async def test_register_returns_working_tokens(account: Account):
    assert account.tokens["tokenType"] == "bearer"
    assert account.tokens["refreshToken"].startswith("vfr_")
    me = await account.get("/v1/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == account.email
    assert me.json()["user"]["hasPassword"] is True
    assert [s["current"] for s in me.json()["sessions"]] == [True]


async def test_register_twice_with_same_email_conflicts(client, account: Account):
    again = await client.post("/v1/auth/register", json={"email": account.email.upper(), "password": "another password"})
    assert again.status_code == 409


async def test_register_rejects_short_password(client):
    response = await client.post("/v1/auth/register", json={"email": "short@example.com", "password": "abc"})
    assert response.status_code == 422


async def test_passwords_are_stored_hashed(db, account: Account):
    stored = await db.users.find_one({"_id": account.id})
    assert stored["passwordHash"].startswith("$argon2id$")
    assert account.password not in stored["passwordHash"]
    session = await db.sessions.find_one({"userId": account.id})
    assert account.tokens["refreshToken"] not in str(session)


async def test_login(client, account: Account):
    response = await client.post("/v1/auth/login", json={"email": f"  {account.email.upper()} ", "password": account.password})
    assert response.status_code == 200
    assert response.json()["user"]["id"] == account.id


async def test_wrong_password_and_unknown_email_look_the_same(client, account: Account):
    wrong = await client.post("/v1/auth/login", json={"email": account.email, "password": "not the password"})
    unknown = await client.post("/v1/auth/login", json={"email": "nobody-here@example.com", "password": "whatever123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


# ---------------------------------------------------------------------------
# Access tokens
# ---------------------------------------------------------------------------

async def test_requests_without_a_valid_token_are_refused(client, app, account: Account):
    assert (await client.get("/v1/me")).status_code == 401
    assert (await client.get("/v1/me", headers={"Authorization": "Bearer nonsense"})).status_code == 401
    # A refresh token is not an access token.
    refresh_as_bearer = {"Authorization": f"Bearer {account.tokens['refreshToken']}"}
    assert (await client.get("/v1/me", headers=refresh_as_bearer)).status_code == 401

    claims = jwt.decode(account.tokens["accessToken"], options={"verify_signature": False})
    forged = jwt.encode({**claims, "sub": "usr_someoneelse"}, "a-different-secret-" + "y" * 40, algorithm="HS256")
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {forged}"})).status_code == 401

    secret = app.state.settings.jwt_secret
    expired = jwt.encode({**claims, "exp": claims["iat"] - 1}, secret, algorithm="HS256")
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {expired}"})).status_code == 401

    unsigned = jwt.encode(claims, None, algorithm="none")
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {unsigned}"})).status_code == 401


# ---------------------------------------------------------------------------
# Refresh tokens
# ---------------------------------------------------------------------------

async def _refresh(client, token: str):
    return await client.post("/v1/auth/refresh", json={"refreshToken": token})


async def test_refresh_rotates_the_token(client, account: Account):
    first = await _refresh(client, account.tokens["refreshToken"])
    assert first.status_code == 200
    rotated = first.json()
    assert rotated["refreshToken"] != account.tokens["refreshToken"]
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {rotated['accessToken']}"})).status_code == 200
    assert (await _refresh(client, rotated["refreshToken"])).status_code == 200


async def test_a_retried_refresh_inside_the_grace_window_does_not_end_the_session(client, account: Account):
    rotated = (await _refresh(client, account.tokens["refreshToken"])).json()
    assert (await _refresh(client, account.tokens["refreshToken"])).status_code == 401
    assert (await _refresh(client, rotated["refreshToken"])).status_code == 200


async def test_reusing_a_rotated_refresh_token_revokes_the_session(client, account: Account, monkeypatch):
    monkeypatch.setattr(accounts, "ROTATION_GRACE_SECONDS", -1)
    rotated = (await _refresh(client, account.tokens["refreshToken"])).json()
    # The old token comes back: someone copied it.
    assert (await _refresh(client, account.tokens["refreshToken"])).status_code == 401
    # And the legitimate holder of the new one is signed out too.
    assert (await _refresh(client, rotated["refreshToken"])).status_code == 401
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {rotated['accessToken']}"})).status_code == 401


async def test_expired_sessions_cannot_refresh(client, db, account: Account):
    await db.sessions.update_many({"userId": account.id}, {"$set": {"expiresAt": utcnow() - timedelta(seconds=1)}})
    assert (await _refresh(client, account.tokens["refreshToken"])).status_code == 401
    assert (await account.get("/v1/me")).status_code == 401


async def test_logout_ends_the_session_immediately(client, account: Account):
    response = await client.post("/v1/auth/logout", json={"refreshToken": account.tokens["refreshToken"]})
    assert response.status_code == 204
    assert (await account.get("/v1/me")).status_code == 401
    assert (await _refresh(client, account.tokens["refreshToken"])).status_code == 401
    # Signing out twice is fine.
    assert (await client.post("/v1/auth/logout", json={"refreshToken": account.tokens["refreshToken"]})).status_code == 204


async def test_signing_out_one_device_from_another(client, account: Account):
    phone = (await client.post("/v1/auth/login", json={"email": account.email, "password": account.password, "deviceName": "Lost phone"})).json()
    sessions = (await account.get("/v1/me")).json()["sessions"]
    lost = next(s for s in sessions if s["deviceName"] == "Lost phone")
    assert (await account.delete(f"/v1/me/sessions/{lost['id']}")).status_code == 204
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {phone['accessToken']}"})).status_code == 401
    assert (await account.get("/v1/me")).status_code == 200


async def test_logout_everywhere(client, account: Account):
    other = (await client.post("/v1/auth/login", json={"email": account.email, "password": account.password})).json()
    assert (await account.post("/v1/auth/logout-everywhere")).status_code == 204
    assert (await account.get("/v1/me")).status_code == 401
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {other['accessToken']}"})).status_code == 401


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

def _code_for(mailbox, email: str) -> str:
    message = [m for m in mailbox.sent if m["to"] == email][-1]
    return re.search(r"\b(\d{6})\b", message["text"]).group(1)


async def test_password_reset(client, mailbox, account: Account):
    assert (await client.post("/v1/auth/password/forgot", json={"email": account.email})).status_code == 202
    code = _code_for(mailbox, account.email)
    wrong = "000000" if code != "000000" else "111111"

    bad = await client.post("/v1/auth/password/reset", json={"email": account.email, "code": wrong, "newPassword": "a brand new password"})
    assert bad.status_code == 400

    good = await client.post("/v1/auth/password/reset", json={"email": account.email, "code": code, "newPassword": "a brand new password"})
    assert good.status_code == 200
    # The old session is gone; the old password no longer works; the new one does.
    assert (await account.get("/v1/me")).status_code == 401
    assert (await client.post("/v1/auth/login", json={"email": account.email, "password": account.password})).status_code == 401
    assert (await client.post("/v1/auth/login", json={"email": account.email, "password": "a brand new password"})).status_code == 200
    # A code works once.
    again = await client.post("/v1/auth/password/reset", json={"email": account.email, "code": code, "newPassword": "yet another password"})
    assert again.status_code == 400


async def test_forgot_password_for_unknown_email_says_the_same_and_sends_nothing(client, mailbox):
    before = len(mailbox.sent)
    response = await client.post("/v1/auth/password/forgot", json={"email": "nobody-at-all@example.com"})
    assert response.status_code == 202
    assert len(mailbox.sent) == before


async def test_reset_codes_stop_working_after_too_many_guesses(client, mailbox, account: Account):
    await client.post("/v1/auth/password/forgot", json={"email": account.email})
    code = _code_for(mailbox, account.email)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        await client.post("/v1/auth/password/reset", json={"email": account.email, "code": wrong, "newPassword": "a brand new password"})
    right = await client.post("/v1/auth/password/reset", json={"email": account.email, "code": code, "newPassword": "a brand new password"})
    assert right.status_code == 400


async def test_reset_codes_are_not_stored_in_plain_text(client, db, mailbox, account: Account):
    await client.post("/v1/auth/password/forgot", json={"email": account.email})
    code = _code_for(mailbox, account.email)
    stored = await db.password_resets.find_one({"_id": account.id})
    assert code not in str(stored)


async def test_change_password_keeps_this_device_and_signs_out_the_rest(client, account: Account):
    other = (await client.post("/v1/auth/login", json={"email": account.email, "password": account.password})).json()
    wrong = await account.post("/v1/auth/password/change", {"currentPassword": "nope nope", "newPassword": "changed password"})
    assert wrong.status_code == 403
    ok = await account.post("/v1/auth/password/change", {"currentPassword": account.password, "newPassword": "changed password"})
    assert ok.status_code == 204
    assert (await account.get("/v1/me")).status_code == 200
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {other['accessToken']}"})).status_code == 401


# ---------------------------------------------------------------------------
# Sign in with Apple
# ---------------------------------------------------------------------------

async def _apple(client, token: str, nonce: str | None = None):
    return await client.post("/v1/auth/apple", json={"identityToken": token, "nonce": nonce})


async def test_apple_sign_in_creates_then_reuses_an_account(client, fake_apple):
    sub = unique_id("apple.")
    first = await _apple(client, fake_apple.token(sub, email=f"{sub}@privaterelay.appleid.com"))
    assert first.status_code == 200, first.text
    assert first.json()["user"]["appleLinked"] is True
    assert first.json()["user"]["hasPassword"] is False
    # Apple only sends the email the first time. The second sign-in has none.
    second = await _apple(client, fake_apple.token(sub))
    assert second.json()["user"]["id"] == first.json()["user"]["id"]


async def test_apple_sign_in_with_a_verified_email_joins_the_existing_account(client, fake_apple, account: Account):
    response = await _apple(client, fake_apple.token(unique_id("apple."), email=account.email, verified="true"))
    assert response.status_code == 200
    assert response.json()["user"]["id"] == account.id
    assert response.json()["user"]["appleLinked"] is True


async def test_apple_sign_in_with_an_unverified_email_does_not_join_an_account(client, fake_apple, account: Account):
    response = await _apple(client, fake_apple.token(unique_id("apple."), email=account.email, verified=False))
    assert response.status_code == 200
    assert response.json()["user"]["id"] != account.id


async def test_apple_tokens_for_another_app_or_unknown_key_are_refused(client, fake_apple):
    assert (await _apple(client, fake_apple.token("x", audience="com.someone.else"))).status_code == 401
    assert (await _apple(client, fake_apple.token("x", kid="unknown-key"))).status_code == 401
    other = type(fake_apple)()  # a different key pair, same kid
    assert (await _apple(client, other.token("x"))).status_code == 401


async def test_apple_nonce_must_match(client, fake_apple):
    import hashlib
    raw = "a-random-nonce"
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    sub = unique_id("apple.")
    assert (await _apple(client, fake_apple.token(sub, nonce=hashed), nonce=raw)).status_code == 200
    assert (await _apple(client, fake_apple.token(sub, nonce=hashed), nonce="different")).status_code == 401


# ---------------------------------------------------------------------------
# Deleting the account
# ---------------------------------------------------------------------------

async def test_delete_account_needs_the_password_and_removes_everything(client, db, account: Account):
    await account.sync("dev1", folders=[{"id": unique_id(), "name": "Bio", "updatedAt": "2026-01-01T00:00:00Z"}])
    assert (await account.delete("/v1/me", {"password": "wrong password"})).status_code == 403
    assert (await account.delete("/v1/me", {"password": account.password})).status_code == 204
    assert await db.users.find_one({"_id": account.id}) is None
    assert await db.sessions.count_documents({"userId": account.id}) == 0
    assert await db.folders.count_documents({"userId": account.id}) == 0
    assert (await account.get("/v1/me")).status_code == 401
    login = await client.post("/v1/auth/login", json={"email": account.email, "password": account.password})
    assert login.status_code == 401


# ---------------------------------------------------------------------------
# Rate limits
# ---------------------------------------------------------------------------

async def test_repeated_failed_logins_are_rate_limited(client, app, account: Account):
    app.state.settings.rate_limits_enabled = True
    try:
        # Up to 20 tries, not exactly 9: the window is fixed, and a run that
        # straddles its boundary starts counting again from zero.
        statuses = []
        for _ in range(20):
            response = await client.post("/v1/auth/login", json={"email": account.email, "password": "guessing guessing"})
            statuses.append(response.status_code)
            if response.status_code == 429:
                break
        assert statuses[-1] == 429
        assert set(statuses[:-1]) == {401}
        assert int(response.headers["Retry-After"]) > 0
        # Even the right password waits out the limit.
        right = await client.post("/v1/auth/login", json={"email": account.email, "password": account.password})
        assert right.status_code == 429
    finally:
        app.state.settings.rate_limits_enabled = False


@pytest.mark.parametrize("path", ["/v1/folders", "/v1/recordings", "/v1/search?q=x", "/v1/me"])
async def test_data_routes_need_a_token(client, path):
    assert (await client.get(path)).status_code == 401
