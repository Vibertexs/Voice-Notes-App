"""Full-text search across transcripts, notes and attachments."""
from backend._router_imports import *  # noqa: F401,F403
from backend._router_imports import APIRouter

router = APIRouter()

SEARCH_KIND_LABELS = {"transcript": "Recording", "note": "Notes", "material": "Attachment"}


def build_match_query(raw: str) -> str:
    """Turn typed words into FTS5 syntax the user cannot accidentally break."""
    words = re.findall(r"[\w']+", raw.lower())[:8]
    if not words:
        return ""
    terms = [f'"{word}"' for word in words[:-1]]
    terms.append(f'"{words[-1]}"*')
    return " AND ".join(terms)


@router.get("/api/search")
def search_everything(
    q: str = Query(default=""), limit: int = Query(default=40, ge=1, le=100)
) -> dict[str, object]:
    """Search transcripts, notes and attachment text across every lecture."""
    match = build_match_query(q)
    if not match:
        return {"query": q, "results": [], "total": 0}
    with connect_database() as connection:
        try:
            rows = connection.execute(
                """
                SELECT kind, ref_id, start_seconds,
                       snippet(search_index, 0, '\u2039', '\u203a', '…', 14) AS excerpt,
                       bm25(search_index) AS score
                FROM search_index
                WHERE search_index MATCH ?
                ORDER BY score
                LIMIT ?
                """,
                (match, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            return {"query": q, "results": [], "total": 0}
        lectures = {
            row["id"]: row
            for row in connection.execute(
                "SELECT id, title, workspace_id, course, created_at FROM lectures"
            ).fetchall()
        }
        workspaces = {
            row["id"]: row
            for row in connection.execute("SELECT id, title FROM workspaces").fetchall()
        }
        materials = {
            row["id"]: row
            for row in connection.execute(
                "SELECT id, original_filename, workspace_id FROM materials"
            ).fetchall()
        }
    results: list[dict[str, object]] = []
    for row in rows:
        kind = row["kind"]
        entry: dict[str, object] = {
            "kind": kind,
            "kind_label": SEARCH_KIND_LABELS.get(kind, kind),
            "excerpt": row["excerpt"],
            "start_seconds": row["start_seconds"],
            "lecture_id": None,
            "workspace_id": None,
            "title": "",
            "context": "",
        }
        if kind == "transcript":
            lecture = lectures.get(row["ref_id"])
            if lecture is None:
                continue
            entry["lecture_id"] = lecture["id"]
            entry["workspace_id"] = lecture["workspace_id"]
            entry["title"] = lecture["title"]
            entry["context"] = lecture["course"] or "Unfiled"
            entry["created_at"] = lecture["created_at"]
        elif kind == "note":
            workspace = workspaces.get(row["ref_id"])
            if workspace is None:
                continue
            entry["workspace_id"] = workspace["id"]
            entry["title"] = workspace["title"]
            entry["context"] = "Lecture notes"
        else:
            material = materials.get(row["ref_id"])
            if material is None:
                continue
            entry["workspace_id"] = material["workspace_id"]
            entry["title"] = material["original_filename"]
            entry["context"] = "Attached file"
        results.append(entry)
    return {"query": q, "results": results, "total": len(results)}


@router.post("/api/search/reindex")
def reindex_search() -> dict[str, object]:
    with connect_database() as connection:
        total = rebuild_search_index(connection)
    return {"status": "rebuilt", "indexed": total}
