"""Coursework files attached to a folder or a lecture."""
from backend._router_imports import *  # noqa: F401,F403
from backend._router_imports import APIRouter

router = APIRouter()


@router.post("/api/materials", status_code=201)
def upload_material(
    material: UploadFile = File(...),
    folder_id: str | None = Query(default=None),
    workspace_id: str | None = Query(default=None),
) -> dict[str, object]:
    if folder_id and workspace_id:
        raise HTTPException(status_code=422, detail="Attach a file to either a folder or one lecture page.")
    workspace = get_workspace(workspace_id) if workspace_id else None
    if workspace:
        folder_id = workspace["folder_id"]
    elif folder_id:
        get_folder(folder_id)
    original_filename = Path((material.filename or "").replace("\\", "/")).name.strip()
    suffix = Path(original_filename).suffix.lower()
    if not original_filename or suffix not in ALLOWED_MATERIAL_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail="Upload a PDF, Word file, PowerPoint, text file, or Markdown file.",
        )

    with connect_database() as connection:
        if workspace_id:
            material_count = connection.execute(
                "SELECT COUNT(*) AS count FROM materials WHERE workspace_id = ?", (workspace_id,)
            ).fetchone()["count"]
        elif folder_id:
            material_count = connection.execute(
                "SELECT COUNT(*) AS count FROM materials WHERE folder_id = ? AND workspace_id IS NULL", (folder_id,)
            ).fetchone()["count"]
        else:
            material_count = connection.execute(
                "SELECT COUNT(*) AS count FROM materials WHERE folder_id IS NULL AND workspace_id IS NULL"
            ).fetchone()["count"]
    if material_count >= MAX_MATERIALS_PER_WORKSPACE:
        location = "lecture page" if workspace_id else "folder"
        raise HTTPException(
            status_code=413,
            detail=f"Keep up to {MAX_MATERIALS_PER_WORKSPACE} files in one {location}.",
        )

    material_id = str(uuid4())
    stored_filename = f"{material_id}{suffix}"
    saved_path = MATERIALS_DIR / stored_filename
    total_bytes = 0
    try:
        with tempfile.TemporaryDirectory(prefix="class-notes-material-") as temp_dir:
            temporary_path = Path(temp_dir) / f"material{suffix}"
            with temporary_path.open("wb") as destination:
                while chunk := material.file.read(1024 * 1024):
                    total_bytes += len(chunk)
                    if total_bytes > MAX_MATERIAL_BYTES:
                        raise HTTPException(status_code=413, detail="Each file must be 25 MB or smaller.")
                    destination.write(chunk)
            if total_bytes == 0:
                raise HTTPException(status_code=400, detail="The uploaded file was empty.")
            extracted_text, extraction_status, extraction_message = extract_material_text(
                temporary_path, suffix
            )
            shutil.copyfile(temporary_path, saved_path)
    except Exception:
        saved_path.unlink(missing_ok=True)
        raise
    finally:
        material.file.close()

    created_at = datetime.now(timezone.utc).isoformat()
    mime_type, _ = mimetypes.guess_type(original_filename)
    try:
        with connect_database() as connection:
            connection.execute(
                """
                INSERT INTO materials (
                    id, workspace_id, folder_id, original_filename, stored_filename, mime_type, size_bytes, created_at,
                    extracted_text, extraction_status, extraction_message, extracted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    material_id,
                    workspace_id,
                    folder_id,
                    original_filename,
                    stored_filename,
                    mime_type or "application/octet-stream",
                    total_bytes,
                    created_at,
                    extracted_text,
                    extraction_status,
                    extraction_message,
                    created_at if extraction_status == "ready" else None,
                ),
            )
    except Exception:
        saved_path.unlink(missing_ok=True)
        raise
    with connect_database() as connection:
        index_material(connection, material_id)
    return serialize_material(get_material(material_id))


@router.post("/api/materials/{material_id}/extract")
def extract_folder_material(material_id: str) -> dict[str, object]:
    """Make an existing local file available to Class AI without re-uploading it."""
    material = get_material(material_id)
    material_path = MATERIALS_DIR / material["stored_filename"]
    if not material_path.is_file():
        raise HTTPException(status_code=404, detail="The saved file is unavailable.")
    extracted_text, extraction_status, extraction_message = extract_material_text(
        material_path, Path(material["original_filename"]).suffix.lower()
    )
    extracted_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            UPDATE materials
            SET extracted_text = ?, extraction_status = ?, extraction_message = ?, extracted_at = ?
            WHERE id = ?
            """,
            (
                extracted_text,
                extraction_status,
                extraction_message,
                extracted_at if extraction_status == "ready" else None,
                material_id,
            ),
        )
        index_material(connection, material_id)
    return serialize_material(get_material(material_id))


@router.get("/api/materials/{material_id}/file")
def download_folder_material(material_id: str) -> FileResponse:
    material = get_material(material_id)
    material_path = MATERIALS_DIR / material["stored_filename"]
    if not material_path.is_file():
        raise HTTPException(status_code=404, detail="The saved file is unavailable.")
    return FileResponse(
        material_path,
        media_type=material["mime_type"],
        filename=material["original_filename"],
    )


@router.delete("/api/materials/{material_id}")
def delete_folder_material(material_id: str) -> dict[str, str]:
    material = get_material(material_id)
    with connect_database() as connection:
        connection.execute("DELETE FROM materials WHERE id = ?", (material_id,))
        drop_from_search_index(connection, "material", material_id)
    (MATERIALS_DIR / material["stored_filename"]).unlink(missing_ok=True)
    return {"status": "deleted"}
