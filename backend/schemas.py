"""Request contracts for the HTTP API.

Keeping these in a dedicated module makes endpoint validation easy to audit and
prevents transport concerns from leaking into storage or AI services.
"""

from pydantic import BaseModel, Field


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = "blue"
    icon: str | None = Field(default=None, max_length=40)


class FolderUpdate(BaseModel):
    """A class can be renamed, recoloured, or put away at the end of term."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, min_length=1, max_length=20)
    icon: str | None = Field(default=None, max_length=40)
    archived: bool | None = None


class LectureUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    note_body: str | None = Field(default=None, max_length=100_000)
    folder_id: str | None = None


class WorkspaceCreate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    folder_id: str | None = None


class WorkspaceUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    folder_id: str | None = None
    favorite: bool | None = None


class WorkspaceNotesUpdate(BaseModel):
    note_body: str = Field(max_length=100_000)


class WorkspaceStudyNotesUpdate(BaseModel):
    note_body: str = Field(max_length=100_000)


class SessionMarkerCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    time_seconds: float = Field(ge=0)


class LocalAIRequest(BaseModel):
    model: str = Field(min_length=1, max_length=180)


class LocalAIQuestion(LocalAIRequest):
    question: str = Field(min_length=1, max_length=4_000)


class LocalAINotesUpdate(LocalAIRequest):
    note_body: str = Field(max_length=100_000)
