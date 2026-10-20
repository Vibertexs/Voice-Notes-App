"""Signing up, signing in, staying signed in, and leaving.

Two ways in:

  - Email and password. Works on every platform, needs nothing set up.
  - Sign in with Apple. Required by the App Store for any iOS app that offers
    other sign-in options, and the nicer path on an iPhone. Enabled by setting
    APPLE_CLIENT_IDS.

Either way the result is the same pair of tokens (see security.py), and an
Apple sign-in whose verified email matches an existing account joins that
account rather than making a second one.

Error messages are worded so they never reveal whether an email has an
account, except at registration, where saying so is the only useful answer.
That endpoint is rate limited to keep it from being used as a lookup.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from backend.cloud import oauth, ratelimit, tokens
from backend.cloud.accounts import (
    delete_account, end_sessions, normalize_email, rotate_session, start_session, user_out,
)
from backend.cloud.apple import AppleTokenError
from backend.cloud.google import GoogleTokenError
from backend.cloud.common import new_id, utcnow
from backend.cloud.config import Settings
from backend.cloud.database import Database
from backend.cloud.deps import DatabaseDep, PrincipalDep, SettingsDep, client_ip
from backend.cloud.models import (
    AccessTokenCreate, AccessTokenOut, AppleSignIn, ChangePassword, DeleteAccount, ForgotPassword, GoogleSignIn, Login, Logout, Refresh,
    Register, ResetPassword, Tokens,
)
from backend.cloud.security import (
    hash_code, hash_password, hash_token, needs_rehash, new_reset_code, same, verify_password,
)

router = APIRouter(prefix="/v1", tags=["accounts"])

BAD_LOGIN = HTTPException(status.HTTP_401_UNAUTHORIZED, "That email and password do not match an account.")
BAD_CODE = HTTPException(status.HTTP_400_BAD_REQUEST, "That code is wrong or has expired. Ask for a new one.")
MAX_CODE_ATTEMPTS = 5


@router.post("/auth/register", response_model=Tokens, status_code=status.HTTP_201_CREATED)
async def register(body: Register, request: Request, database: DatabaseDep, settings: SettingsDep) -> Tokens:
    await ratelimit.hit(database, settings, "register:ip", client_ip(request))
    user = {
        "_id": new_id("usr_"),
        "email": normalize_email(body.email),
        "passwordHash": await hash_password(body.password),
        "appleSub": None,
        "googleSub": None,
        "createdAt": utcnow(),
    }
    try:
        # The unique index decides, not a find-then-insert: two sign-ups
        # racing with the same email cannot both get through.
        await database.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists. Sign in instead.") from None
    return await start_session(database, settings, user, request, body.device_name)


@router.post("/auth/login", response_model=Tokens)
async def login(body: Login, request: Request, database: DatabaseDep, settings: SettingsDep) -> Tokens:
    email = normalize_email(body.email)
    await ratelimit.hit(database, settings, "login:ip", client_ip(request))
    await ratelimit.hit(database, settings, "login:email", email)
    user = await database.users.find_one({"email": email})
    # verify_password still runs, against a dummy hash, when there is no such
    # user - so a wrong email takes exactly as long as a wrong password.
    if not await verify_password(user.get("passwordHash") if user else None, body.password):
        raise BAD_LOGIN
    if needs_rehash(user["passwordHash"]):
        await database.users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": await hash_password(body.password)}})
    return await start_session(database, settings, user, request, body.device_name)


@router.post("/auth/refresh", response_model=Tokens)
async def refresh(body: Refresh, request: Request, database: DatabaseDep, settings: SettingsDep) -> Tokens:
    await ratelimit.hit(database, settings, "refresh:ip", client_ip(request))
    return await rotate_session(database, settings, body.refresh_token)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: Logout, database: DatabaseDep) -> Response:
    """Ends the session the refresh token belongs to.

    Takes the refresh token rather than the access token so that signing out
    works even when the access token has already expired - the usual case for
    an app that has been in the background. Always succeeds: signing out of a
    session that is already gone is not an error.
    """
    if body.refresh_token:
        token = hash_token(body.refresh_token)
        await database.sessions.delete_one({"$or": [{"tokenHash": token}, {"previousTokenHash": token}]})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/auth/logout-everywhere", status_code=status.HTTP_204_NO_CONTENT)
async def logout_everywhere(principal: PrincipalDep, database: DatabaseDep) -> Response:
    await end_sessions(database, principal.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

@router.post("/auth/password/forgot", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    body: ForgotPassword, request: Request, background: BackgroundTasks,
    database: DatabaseDep, settings: SettingsDep,
) -> dict[str, Any]:
    """Emails a six-digit code. Answers the same whether or not the account exists."""
    email = normalize_email(body.email)
    await ratelimit.hit(database, settings, "forgot:ip", client_ip(request))
    await ratelimit.hit(database, settings, "forgot:email", email)
    user = await database.users.find_one({"email": email}, projection={"_id": 1})
    if user is not None:
        code = new_reset_code()
        # One live code per user: asking again replaces the previous one.
        await database.password_resets.replace_one(
            {"_id": user["_id"]},
            {
                "userId": user["_id"],
                "codeHash": hash_code(settings, code),
                "attempts": 0,
                "expiresAt": utcnow() + timedelta(minutes=settings.password_reset_minutes),
            },
            upsert=True,
        )
        # Sent after the response, so the response takes as long whether an
        # email went out or not.
        background.add_task(
            request.app.state.email.send, email, "Your VoiceFlow reset code",
            f"Your VoiceFlow password reset code is {code}.\n\n"
            f"It expires in {settings.password_reset_minutes} minutes. If you did not ask for it, ignore this email.",
        )
    return {"ok": True, "detail": "If that email has an account, a code is on its way."}


@router.post("/auth/password/reset", response_model=Tokens)
async def reset_password(body: ResetPassword, request: Request, database: DatabaseDep, settings: SettingsDep) -> Tokens:
    email = normalize_email(body.email)
    await ratelimit.hit(database, settings, "reset:email", email)
    user = await database.users.find_one({"email": email})
    if user is None:
        raise BAD_CODE
    # Count the attempt before checking it, atomically, so parallel guesses
    # cannot all slip in under the limit.
    reset = await database.password_resets.find_one_and_update(
        {"_id": user["_id"], "expiresAt": {"$gt": utcnow()}},
        {"$inc": {"attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if reset is None or reset["attempts"] > MAX_CODE_ATTEMPTS:
        raise BAD_CODE
    if not same(reset["codeHash"], hash_code(settings, body.code)):
        raise BAD_CODE

    await database.password_resets.delete_one({"_id": user["_id"]})
    await database.users.update_one(
        {"_id": user["_id"]}, {"$set": {"passwordHash": await hash_password(body.new_password)}})
    # Whoever knew the old password is signed out everywhere.
    await end_sessions(database, user["_id"])
    user = await database.users.find_one({"_id": user["_id"]})
    return await start_session(database, settings, user, request, body.device_name)


@router.post("/auth/password/change", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(body: ChangePassword, principal: PrincipalDep, database: DatabaseDep) -> Response:
    current = principal.user.get("passwordHash")
    if current is not None and not await verify_password(current, body.current_password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your current password is not right.")
    await database.users.update_one(
        {"_id": principal.user_id}, {"$set": {"passwordHash": await hash_password(body.new_password)}})
    await end_sessions(database, principal.user_id, keep=principal.session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Sign in with Apple / Google
# ---------------------------------------------------------------------------

def _verified_email(claims: dict[str, Any]) -> str | None:
    """The provider's email, only if the provider vouches for it.

    email_verified arrives as a boolean or as the string "true" depending on
    the provider and flow. An unverified email is never used to join an
    existing account: that would let anyone claim any account by typing its
    address.
    """
    email = claims.get("email")
    verified = claims.get("email_verified") in (True, "true")
    return normalize_email(email) if email and verified else None


async def _provider_sign_in(
    request: Request, database: Database, settings: Settings, *,
    verifier: Any, token_error: type[Exception], field: str, bucket: str,
    token: str, nonce: str | None, device_name: str | None, label: str,
) -> Tokens:
    """One sign-in path for every OpenID provider; `field` is where the
    provider's stable user id is stored on the user."""
    if not verifier.enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sign in with {label} is not set up on this server.")
    await ratelimit.hit(database, settings, bucket, client_ip(request))
    try:
        claims = await verifier.verify(token, nonce)
    except token_error as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(error)) from None

    subject = claims["sub"]
    email = _verified_email(claims)
    user = await database.users.find_one({field: subject})
    if user is None and email:
        # The same person's password account, found by the verified address.
        candidate = await database.users.find_one({"email": email, field: None})
        if candidate is not None:
            await database.users.update_one(
                {"_id": candidate["_id"], field: None},
                # The password goes, because nobody ever proved the address
                # belonged to whoever typed it at registration. Without this,
                # someone could register a victim's email with a password of
                # their own and keep that password after the victim signs in
                # with the provider. The real owner can set a new one through
                # the emailed reset code.
                {"$set": {field: subject, "passwordHash": None}},
            )
            if candidate.get("passwordHash"):
                await end_sessions(database, candidate["_id"])
            user = await database.users.find_one({"_id": candidate["_id"]})
    if user is None:
        user = {"_id": new_id("usr_"), "email": email, "passwordHash": None,
                "appleSub": None, "googleSub": None, field: subject, "createdAt": utcnow()}
        try:
            await database.users.insert_one(user)
        except DuplicateKeyError:
            # Lost a race with a parallel sign-in for the same provider id.
            user = await database.users.find_one({field: subject})
            if user is None:
                raise
    return await start_session(database, settings, user, request, device_name)


@router.post("/auth/apple", response_model=Tokens)
async def apple_sign_in(body: AppleSignIn, request: Request, database: DatabaseDep, settings: SettingsDep) -> Tokens:
    return await _provider_sign_in(
        request, database, settings, verifier=request.app.state.apple, token_error=AppleTokenError,
        field="appleSub", bucket="apple:ip", token=body.identity_token, nonce=body.nonce,
        device_name=body.device_name, label="Apple")


@router.post("/auth/google", response_model=Tokens)
async def google_sign_in(body: GoogleSignIn, request: Request, database: DatabaseDep, settings: SettingsDep) -> Tokens:
    return await _provider_sign_in(
        request, database, settings, verifier=request.app.state.google, token_error=GoogleTokenError,
        field="googleSub", bucket="google:ip", token=body.id_token, nonce=None,
        device_name=body.device_name, label="Google")


# ---------------------------------------------------------------------------
# The signed-in account
# ---------------------------------------------------------------------------

@router.get("/me")
async def me(principal: PrincipalDep, database: DatabaseDep) -> dict[str, Any]:
    sessions = database.sessions.find(
        {"userId": principal.user_id},
        projection={"deviceName": 1, "createdAt": 1, "lastUsedAt": 1},
    ).sort("lastUsedAt", -1)
    return {
        "user": user_out(principal.user),
        "sessions": [
            {
                "id": session["_id"],
                "deviceName": session.get("deviceName"),
                "createdAt": session["createdAt"],
                "lastUsedAt": session.get("lastUsedAt"),
                "current": session["_id"] == principal.session_id,
            }
            async for session in sessions
        ],
    }


@router.delete("/me/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def end_session(session_id: str, principal: PrincipalDep, database: DatabaseDep) -> Response:
    """Signs out one device - the lost phone, say."""
    result = await database.sessions.delete_one({"_id": session_id, "userId": principal.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That device is not signed in.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/tokens", response_model=list[AccessTokenOut])
async def list_tokens(principal: PrincipalDep, database: DatabaseDep) -> list[dict[str, Any]]:
    """The assistants allowed to read this account's lectures."""
    return await tokens.list_for(database, principal.user_id)


@router.post("/me/tokens", response_model=AccessTokenOut, status_code=status.HTTP_201_CREATED)
async def create_token(body: AccessTokenCreate, principal: PrincipalDep, database: DatabaseDep,
                       settings: SettingsDep) -> dict[str, Any]:
    """Makes a read-only token for an assistant. The token is in this response
    and nowhere else - it cannot be shown again."""
    record, plain = await tokens.create(database, settings, principal.user_id, body.name)
    return tokens.present(record, token=plain)


@router.delete("/me/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: str, principal: PrincipalDep, database: DatabaseDep) -> Response:
    if not await tokens.revoke(database, principal.user_id, token_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That token does not exist.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/connections")
async def list_connections(principal: PrincipalDep, database: DatabaseDep) -> list[dict[str, Any]]:
    """Assistants this account let in by signing in (Claude, ChatGPT...), as opposed to
    the hand-made tokens above."""
    return await oauth.list_grants(database, principal.user_id)


@router.delete("/me/connections/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(grant_id: str, principal: PrincipalDep, request: Request) -> Response:
    """Cuts one assistant off: its access and refresh tokens stop working at once."""
    provider = getattr(request.app.state, "oauth", None)
    if provider is None or not await provider.revoke_grant(principal.user_id, grant_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That connection does not exist.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(body: DeleteAccount, principal: PrincipalDep, database: DatabaseDep) -> Response:
    """Deletes the account and everything synced to it.

    An account with a password must confirm it: a phone left unlocked on a
    desk should not be enough to erase someone's semester. Recordings already
    on a phone stay on that phone.
    """
    current = principal.user.get("passwordHash")
    if current is not None and not await verify_password(current, body.password or ""):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Enter your password to delete your account.")
    await delete_account(database, principal.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
