"""The API's request and response shapes.

JSON is camelCase, because every client is JavaScript. Python stays snake_case;
the alias generator translates at the edge.

Every list and string that comes from a client has a ceiling. Without them a
single request could ask the server to store a gigabyte, and the 16MB document
limit would turn that into a confusing error deep in the driver instead of a
clear 422 at the door.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel

from backend.cloud.common import ID_PATTERN, as_utc

Id = Annotated[str, Field(pattern=ID_PATTERN)]

FOLDER_COLORS = {
    "red", "blue", "violet", "amber", "green", "graphite",
    # Older names the phone may still have stored.
    "rose", "coral", "lime", "mint", "sky", "slate",
}


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class UtcModel(Model):
    """Any datetime field is normalised to UTC, millisecond precision."""

    @field_validator("*", mode="after")
    @classmethod
    def _utc(cls, value: object) -> object:
        return as_utc(value) if isinstance(value, datetime) else value


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

Password = Annotated[str, Field(min_length=8, max_length=128)]


class Register(Model):
    email: EmailStr
    password: Password
    device_name: str | None = Field(default=None, max_length=80)

    @field_validator("password")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Password cannot be only spaces.")
        return value


class Login(Model):
    email: EmailStr
    # No length rule here: a login form should not reveal the password policy.
    password: str = Field(min_length=1, max_length=128)
    device_name: str | None = Field(default=None, max_length=80)


class Refresh(Model):
    refresh_token: str = Field(min_length=10, max_length=200)


class Logout(Model):
    refresh_token: str | None = Field(default=None, max_length=200)


class ForgotPassword(Model):
    email: EmailStr


class ResetPassword(Model):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: Password
    device_name: str | None = Field(default=None, max_length=80)


class ChangePassword(Model):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: Password


class DeleteAccount(Model):
    password: str | None = Field(default=None, max_length=128)


class AppleSignIn(Model):
    identity_token: str = Field(min_length=20, max_length=8000)
    nonce: str | None = Field(default=None, max_length=200)
    device_name: str | None = Field(default=None, max_length=80)


class GoogleSignIn(Model):
    id_token: str = Field(min_length=20, max_length=8000)
    device_name: str | None = Field(default=None, max_length=80)


class User(UtcModel):
    id: str
    email: str | None
    created_at: datetime
    has_password: bool
    apple_linked: bool
    google_linked: bool = False


class Tokens(Model):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: User


# ---------------------------------------------------------------------------
# Synced documents
# ---------------------------------------------------------------------------

class SyncedDoc(UtcModel):
    id: Id
    updated_at: datetime
    deleted_at: datetime | None = None


class FolderDoc(SyncedDoc):
    name: str = Field(default="", max_length=120)
    color: str = "blue"
    icon: str | None = Field(default=None, max_length=40)
    parent_id: Id | None = None
    created_at: datetime | None = None
    archived_at: datetime | None = None

    @field_validator("color")
    @classmethod
    def _known_color(cls, value: str) -> str:
        return value if value in FOLDER_COLORS else "blue"


class Marker(UtcModel):
    id: Id
    label: str = Field(max_length=200)
    time_seconds: float = Field(ge=0, le=7 * 24 * 3600)
    created_at: datetime | None = None


class Transcription(Model):
    status: str = Field(default="unavailable", max_length=20)
    model: str | None = Field(default=None, max_length=60)


class Audio(Model):
    """Where the audio lives. Informational: the server never receives it."""

    file_name: str | None = Field(default=None, max_length=200)
    bytes: int | None = Field(default=None, ge=0)
    device_id: Id | None = None


class RecordingDoc(SyncedDoc):
    folder_id: Id | None = None
    title: str = Field(default="", max_length=300)
    favorite: bool = False
    created_at: datetime | None = None
    duration_seconds: float | None = Field(default=None, ge=0, le=7 * 24 * 3600)
    transcription: Transcription = Field(default_factory=Transcription)
    audio: Audio | None = None
    markers: list[Marker] = Field(default_factory=list, max_length=2000)
    notes: str = Field(default="", max_length=200_000)


class Word(Model):
    """Compact on purpose: a long lecture has fifteen thousand of these."""

    w: str = Field(max_length=200)
    s: float = Field(ge=0)
    e: float | None = Field(default=None, ge=0)


class Segment(Model):
    start: float = Field(ge=0)
    end: float | None = Field(default=None, ge=0)
    text: str = Field(max_length=5000)
    words: list[Word] = Field(default_factory=list, max_length=2000)


class TranscriptDoc(SyncedDoc):
    text: str = Field(default="", max_length=2_000_000)
    segments: list[Segment] = Field(default_factory=list, max_length=20_000)


class SyncChanges(Model):
    folders: list[FolderDoc] = Field(default_factory=list, max_length=500)
    recordings: list[RecordingDoc] = Field(default_factory=list, max_length=500)
    transcripts: list[TranscriptDoc] = Field(default_factory=list, max_length=50)


class SyncRequest(Model):
    device_id: Id
    cursor: str | None = Field(default=None, max_length=2000)
    changes: SyncChanges = Field(default_factory=SyncChanges)


class SyncResult(Model):
    cursor: str
    more: bool
    server_time: datetime
    applied: dict[str, list[str]]
    rejected: dict[str, list[str]]
    changes: dict[str, list[dict]]


# ---------------------------------------------------------------------------
# Library (REST)
# ---------------------------------------------------------------------------

class FolderCreate(Model):
    name: str = Field(min_length=1, max_length=120)
    color: str = "blue"
    icon: str | None = Field(default=None, max_length=40)


class FolderUpdate(Model):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = None
    icon: str | None = Field(default=None, max_length=40)
    archived: bool | None = None


class RecordingUpdate(Model):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    # "inbox" moves it out of every folder; omit the field to leave it alone.
    folder_id: str | None = Field(default=None, max_length=64)
    favorite: bool | None = None
