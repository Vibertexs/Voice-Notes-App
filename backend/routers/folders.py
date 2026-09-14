"""Classes. One folder is one class; archiving retires it at end of term."""
from backend._router_imports import *  # noqa: F401,F403
from backend._router_imports import APIRouter

router = APIRouter()


@router.post("/api/folders", status_code=201)
def create_folder(folder: FolderCreate) -> dict[str, object]:
    name = clean_label(folder.name, "Untitled class", 120)
    color = folder.color if folder.color in FOLDER_COLORS else "blue"
    with connect_database() as connection:
        duplicate = connection.execute(
            "SELECT 1 FROM folders WHERE lower(name) = lower(?)", (name,)
        ).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail="You already have a class with that name.")
        folder_id = str(uuid4())
        connection.execute(
            "INSERT INTO folders (id, name, parent_id, color, created_at) VALUES (?, ?, NULL, ?, ?)",
            (folder_id, name, color, datetime.now(timezone.utc).isoformat()),
        )
    return serialize_folder(get_folder(folder_id))


@router.patch("/api/folders/{folder_id}")
def update_folder(folder_id: str, update: FolderUpdate) -> dict[str, object]:
    get_folder(folder_id)
    changes: list[str] = []
    values: list[object] = []

    if update.name is not None:
        name = clean_label(update.name, "Untitled class", 120)
        with connect_database() as connection:
            duplicate = connection.execute(
                "SELECT 1 FROM folders WHERE lower(name) = lower(?) AND id != ?",
                (name, folder_id),
            ).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail="You already have a class with that name.")
        changes.append("name = ?")
        values.append(name)

    if update.color is not None:
        if update.color not in FOLDER_COLORS:
            raise HTTPException(status_code=422, detail="Choose a valid class color.")
        changes.append("color = ?")
        values.append(update.color)

    if update.archived is not None:
        changes.append("archived_at = ?")
        values.append(datetime.now(timezone.utc).isoformat() if update.archived else None)

    if changes:
        values.append(folder_id)
        with connect_database() as connection:
            connection.execute(
                f"UPDATE folders SET {', '.join(changes)} WHERE id = ?", tuple(values)
            )
    return serialize_folder(get_folder(folder_id))


@router.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: str) -> dict[str, str]:
    """Deleting is for empty classes. A class with work in it gets archived."""
    get_folder(folder_id)
    with connect_database() as connection:
        for table in ("lectures", "workspaces", "materials"):
            in_use = connection.execute(
                f"SELECT 1 FROM {table} WHERE folder_id = ? LIMIT 1", (folder_id,)
            ).fetchone()
            if in_use:
                raise HTTPException(
                    status_code=409,
                    detail="This class still has work in it. Archive it instead, "
                           "or move its lectures out first.",
                )
        connection.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    return {"status": "deleted"}
