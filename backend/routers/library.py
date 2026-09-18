"""Library browsing: the shelf, its folders, and what sits on them."""
from backend._router_imports import *  # noqa: F401,F403
from backend._router_imports import APIRouter

router = APIRouter()


@router.get("/", include_in_schema=False)
def index() -> FileResponse:
    # The UI is built from the versioned React source with `npm run build`.
    frontend = FRONTEND_DIST / "index.html"
    if not frontend.is_file():
        raise HTTPException(status_code=503, detail="Frontend bundle is missing. Run `npm run build`.")
    return FileResponse(frontend)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/library")
def list_library(
    folder_id: str | None = Query(default=None),
    archived: bool = Query(default=False),
) -> dict[str, object]:
    current_folder = get_folder(folder_id) if folder_id else None
    with connect_database() as connection:
        if folder_id:
            folders = []
            workspaces = connection.execute(
                """
                SELECT workspaces.*, COUNT(lectures.id) AS session_count,
                       SUM(lectures.duration_seconds) AS duration_seconds
                FROM workspaces
                LEFT JOIN lectures ON lectures.workspace_id = workspaces.id
                WHERE workspaces.folder_id = ?
                GROUP BY workspaces.id
                ORDER BY workspaces.updated_at DESC
                """,
                (folder_id,),
            ).fetchall()
            materials = connection.execute(
                "SELECT * FROM materials WHERE folder_id = ? AND workspace_id IS NULL ORDER BY created_at DESC", (folder_id,)
            ).fetchall()
        else:
            folders = connection.execute(
                """
                SELECT folders.*,
                       COUNT(DISTINCT workspaces.id) AS lecture_count,
                       COUNT(lectures.id) AS recording_count,
                       (SELECT COUNT(*) FROM materials
                         WHERE materials.folder_id = folders.id) AS file_count,
                       MAX(workspaces.updated_at) AS updated_at
                FROM folders
                LEFT JOIN workspaces ON workspaces.folder_id = folders.id
                LEFT JOIN lectures ON lectures.workspace_id = workspaces.id
                WHERE folders.archived_at IS {state} NULL
                GROUP BY folders.id
                ORDER BY folders.name COLLATE NOCASE
                """.format(state="NOT" if archived else "")
            ).fetchall()
            workspaces = connection.execute(
                """
                SELECT workspaces.*, COUNT(lectures.id) AS session_count,
                       SUM(lectures.duration_seconds) AS duration_seconds
                FROM workspaces
                LEFT JOIN lectures ON lectures.workspace_id = workspaces.id
                WHERE workspaces.folder_id IS NULL
                GROUP BY workspaces.id
                ORDER BY workspaces.updated_at DESC
                """
            ).fetchall()
            materials = connection.execute(
                "SELECT * FROM materials WHERE folder_id IS NULL AND workspace_id IS NULL ORDER BY created_at DESC"
            ).fetchall()
    return {
        "current_folder": serialize_folder(current_folder) if current_folder else None,
        "breadcrumbs": get_folder_path(current_folder),
        "folders": [serialize_folder(folder) for folder in folders],
        "workspaces": [serialize_workspace(workspace) for workspace in workspaces],
        "lectures": [],
        "materials": [serialize_material(material) for material in materials],
    }


@router.get("/api/folders")
def list_folders() -> dict[str, list[dict[str, object]]]:
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT * FROM folders ORDER BY name COLLATE NOCASE"
        ).fetchall()
    return {"folders": [serialize_folder(folder) for folder in rows]}


@router.get("/api/recordings")
def list_recordings() -> dict[str, list[dict[str, object]]]:
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT * FROM lectures ORDER BY created_at DESC LIMIT 30"
        ).fetchall()
    return {"recordings": [serialize_lecture(recording, include_content=False) for recording in rows]}
