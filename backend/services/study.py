"""Pure note-formatting and local study-guide helpers."""

from collections import Counter
from datetime import datetime
import re

from fastapi import HTTPException


def clean_label(value: str, fallback: str, limit: int) -> str:
    """Normalize a user-facing name without surprising whitespace."""
    return " ".join(value.split())[:limit] or fallback


def default_lecture_title(created_at: datetime) -> str:
    return f"Lecture — {created_at.astimezone().strftime('%b %d, %Y at %I:%M %p')}"


def append_capture_notes(existing_notes: str, capture_notes: str, created_at: datetime, heading: str = "Capture notes") -> str:
    """Append in-class notes in a consistently readable format."""
    note_heading = created_at.astimezone().strftime("%b %d, %Y at %I:%M %p")
    addition = f"## {heading} — {note_heading}\n\n{capture_notes.strip()}"
    return f"{existing_notes.rstrip()}\n\n{addition}\n" if existing_notes.strip() else f"{addition}\n"


STUDY_STOP_WORDS = frozenset((
    "a about after again all also am an and any are as at be because been before being but by can "
    "could did do does each for from had has have he her here hers herself him himself his how i if in "
    "into is it its itself just may me more most my no not of on once only or other our out over own same "
    "she should so some such than that the their theirs them themselves then there these they this those through "
    "to too under up us was we were what when where which while who will with would you your yours yourself"
).split())


def study_words(text: str) -> list[str]:
    return [word.lower() for word in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", text)]


def study_sentences(text: str) -> list[str]:
    normalized = re.sub(r"(?m)^\s*(?:#{1,6}|[-*])\s*", "", text)
    candidates = re.split(r"(?<=[.!?])\s+|\n+", normalized)
    result: list[str] = []
    for candidate in candidates:
        candidate = " ".join(candidate.split())
        if 28 <= len(candidate) <= 360 and len(study_words(candidate)) >= 5:
            result.append(candidate)
    return result


def build_local_study_draft(title: str, note_body: str, transcripts: list[str]) -> str:
    """Create a transparent, local review outline; it is not an LLM summary."""
    source_text = "\n".join([note_body, *transcripts])
    words = [word for word in study_words(source_text) if word not in STUDY_STOP_WORDS]
    if len(words) < 8:
        raise HTTPException(status_code=422, detail="Add a few notes or save a recording before making a study draft.")
    terms = [term for term, _ in Counter(words).most_common(5)]
    selected: list[str] = []
    seen: set[str] = set()
    for candidate in study_sentences(source_text):
        fingerprint = candidate.casefold()
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        selected.append(candidate)
        if len(selected) == 4:
            break
    if not selected:
        selected = ["Review the original notes and recording to identify the main ideas."]
    session_label = "recording" if len(transcripts) == 1 else "recordings"
    key_ideas = "\n".join(f"- {sentence}" for sentence in selected)
    terms_list = "\n".join(f"- **{term.title()}** — define this in your own words." for term in terms[:4])
    questions = "\n".join(f"- How would you explain **{term.title()}** without looking at your notes?" for term in terms[:3])
    return f"""# {title} — study draft

_Made locally from your notes and {len(transcripts)} saved {session_label}. Check it against class before studying._

## Key ideas
{key_ideas}

## Terms to know
{terms_list}

## Questions to review
{questions}
"""
