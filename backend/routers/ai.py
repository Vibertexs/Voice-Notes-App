"""Local-only assistant over a lecture or a whole class."""
from backend._router_imports import *  # noqa: F401,F403
from backend._router_imports import APIRouter

router = APIRouter()


@router.get("/api/ai/status")
def read_local_ai_status() -> dict[str, object]:
    return local_ai_status()


@router.get("/api/folders/{folder_id}/class-ai")
def read_class_ai(folder_id: str) -> dict[str, object]:
    folder = get_folder(folder_id)
    workspace_sources = class_ai_sources(folder_id)
    folder_ids = descendant_folder_ids(folder_id)
    placeholders = ", ".join("?" for _ in folder_ids)
    with connect_database() as connection:
        ai_notes = connection.execute(
            "SELECT note_body, model, updated_at FROM folder_ai_notes WHERE folder_id = ?",
            (folder_id,),
        ).fetchone()
        messages = connection.execute(
            "SELECT * FROM folder_ai_messages WHERE folder_id = ? ORDER BY created_at ASC",
            (folder_id,),
        ).fetchall()
        material_count = connection.execute(
            f"SELECT COUNT(*) AS count FROM materials WHERE folder_id IN ({placeholders})",
            folder_ids,
        ).fetchone()["count"]
    return {
        "folder": serialize_folder(folder),
        "lecture_count": len(workspace_sources),
        "recording_count": sum(source["session_count"] for source in workspace_sources),
        "material_count": material_count,
        "ai_notes": ai_notes["note_body"] if ai_notes else "",
        "ai_notes_model": ai_notes["model"] if ai_notes else None,
        "ai_notes_updated_at": ai_notes["updated_at"] if ai_notes else None,
        "messages": [serialize_ai_message(message) for message in messages],
    }


@router.put("/api/folders/{folder_id}/class-ai/notes")
def save_class_ai_notes(folder_id: str, update: LocalAINotesUpdate) -> dict[str, object]:
    get_folder(folder_id)
    saved_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO folder_ai_notes (folder_id, note_body, model, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(folder_id) DO UPDATE SET
                note_body = excluded.note_body,
                model = excluded.model,
                updated_at = excluded.updated_at
            """,
            (folder_id, update.note_body, update.model, saved_at),
        )
    return {"status": "saved", "model": update.model, "updated_at": saved_at}


@router.post("/api/folders/{folder_id}/class-ai/notes")
def generate_class_ai_notes(folder_id: str, request: LocalAIRequest) -> dict[str, object]:
    get_folder(folder_id)
    context = build_class_ai_context(folder_id)
    prompt = (
        "Write a focused class study guide from the class's saved lecture notes, recordings, and imported files for a high "
        "school or college student. Use the headings Overview, Connections across lectures, Key ideas, "
        "Terms to know, and Questions to review when the source supports them. Keep it accurate and "
        "easy to scan. Do not claim that imported files were read unless their text appears in the source."
    )
    note_body = ask_local_model(
        request.model,
        [
            {"role": "system", "content": local_ai_system_prompt(context)},
            {"role": "user", "content": prompt},
        ],
    )
    saved_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO folder_ai_notes (folder_id, note_body, model, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(folder_id) DO UPDATE SET
                note_body = excluded.note_body,
                model = excluded.model,
                updated_at = excluded.updated_at
            """,
            (folder_id, note_body, request.model, saved_at),
        )
    return {"note_body": note_body, "model": request.model, "updated_at": saved_at}


@router.post("/api/folders/{folder_id}/class-ai/questions")
def ask_class_ai_question(folder_id: str, request: LocalAIQuestion) -> dict[str, object]:
    get_folder(folder_id)
    question = " ".join(request.question.split())
    if not question:
        raise HTTPException(status_code=422, detail="Ask a question before sending it.")
    context = build_class_ai_context(folder_id)
    with connect_database() as connection:
        history = connection.execute(
            """
            SELECT role, content FROM (
                SELECT role, content, created_at
                FROM folder_ai_messages
                WHERE folder_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            ) ORDER BY created_at ASC
            """,
            (folder_id, LOCAL_AI_HISTORY_LIMIT),
        ).fetchall()
    messages = [{"role": "system", "content": local_ai_system_prompt(context)}]
    messages.extend({"role": row["role"], "content": row["content"]} for row in history)
    messages.append({"role": "user", "content": question})
    answer = ask_local_model(request.model, messages)
    created_at = datetime.now(timezone.utc).isoformat()
    question_id = str(uuid4())
    answer_id = str(uuid4())
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO folder_ai_messages (id, folder_id, role, content, model, created_at)
            VALUES (?, ?, 'user', ?, ?, ?)
            """,
            (question_id, folder_id, question, request.model, created_at),
        )
        connection.execute(
            """
            INSERT INTO folder_ai_messages (id, folder_id, role, content, model, created_at)
            VALUES (?, ?, 'assistant', ?, ?, ?)
            """,
            (answer_id, folder_id, answer, request.model, created_at),
        )
    return {
        "question": {
            "id": question_id,
            "role": "user",
            "content": question,
            "model": request.model,
            "created_at": created_at,
        },
        "answer": {
            "id": answer_id,
            "role": "assistant",
            "content": answer,
            "model": request.model,
            "created_at": created_at,
        },
    }


@router.delete("/api/folders/{folder_id}/class-ai/messages")
def clear_class_ai_messages(folder_id: str) -> dict[str, str]:
    get_folder(folder_id)
    with connect_database() as connection:
        connection.execute("DELETE FROM folder_ai_messages WHERE folder_id = ?", (folder_id,))
    return {"status": "deleted"}


@router.get("/api/workspaces/{workspace_id}/ai/messages")
def read_workspace_ai_messages(workspace_id: str) -> dict[str, object]:
    get_workspace(workspace_id)
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT * FROM workspace_ai_messages WHERE workspace_id = ? ORDER BY created_at ASC",
            (workspace_id,),
        ).fetchall()
    return {"messages": [serialize_ai_message(row) for row in rows]}


@router.put("/api/workspaces/{workspace_id}/ai/notes")
def save_workspace_ai_notes(workspace_id: str, update: LocalAINotesUpdate) -> dict[str, object]:
    get_workspace(workspace_id)
    saved_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO workspace_ai_notes (workspace_id, note_body, model, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                note_body = excluded.note_body,
                model = excluded.model,
                updated_at = excluded.updated_at
            """,
            (workspace_id, update.note_body, update.model, saved_at),
        )
        connection.execute(
            "UPDATE workspaces SET updated_at = ? WHERE id = ?", (saved_at, workspace_id)
        )
    return {"status": "saved", "model": update.model, "updated_at": saved_at}


@router.post("/api/workspaces/{workspace_id}/ai/notes")
def generate_workspace_ai_notes(workspace_id: str, request: LocalAIRequest) -> dict[str, object]:
    workspace = get_workspace(workspace_id)
    context = build_workspace_ai_context(workspace_id)
    prompt = (
        "Write study notes from the source material for a high school or college student. "
        "Use the headings Overview, Key ideas, Terms to know, and Questions to review when "
        "the source supports them. Keep the notes focused, correct, and easy to scan. Base every "
        "claim on the lecture note and recordings supplied in the source material."
    )
    note_body = ask_local_model(
        request.model,
        [
            {"role": "system", "content": local_ai_system_prompt(context)},
            {"role": "user", "content": prompt},
        ],
    )
    saved_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO workspace_ai_notes (workspace_id, note_body, model, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                note_body = excluded.note_body,
                model = excluded.model,
                updated_at = excluded.updated_at
            """,
            (workspace_id, note_body, request.model, saved_at),
        )
        connection.execute(
            "UPDATE workspaces SET updated_at = ? WHERE id = ?", (saved_at, workspace_id)
        )
    return {"note_body": note_body, "model": request.model, "updated_at": saved_at}


@router.post("/api/workspaces/{workspace_id}/ai/questions")
def ask_workspace_ai_question(workspace_id: str, request: LocalAIQuestion) -> dict[str, object]:
    get_workspace(workspace_id)
    question = " ".join(request.question.split())
    if not question:
        raise HTTPException(status_code=422, detail="Ask a question before sending it.")
    context = build_workspace_ai_context(workspace_id)
    with connect_database() as connection:
        history = connection.execute(
            """
            SELECT role, content FROM (
                SELECT role, content, created_at
                FROM workspace_ai_messages
                WHERE workspace_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            ) ORDER BY created_at ASC
            """,
            (workspace_id, LOCAL_AI_HISTORY_LIMIT),
        ).fetchall()
    messages = [{"role": "system", "content": local_ai_system_prompt(context)}]
    messages.extend({"role": row["role"], "content": row["content"]} for row in history)
    messages.append({"role": "user", "content": question})
    answer = ask_local_model(request.model, messages)
    created_at = datetime.now(timezone.utc).isoformat()
    question_id = str(uuid4())
    answer_id = str(uuid4())
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO workspace_ai_messages (id, workspace_id, role, content, model, created_at)
            VALUES (?, ?, 'user', ?, ?, ?)
            """,
            (question_id, workspace_id, question, request.model, created_at),
        )
        connection.execute(
            """
            INSERT INTO workspace_ai_messages (id, workspace_id, role, content, model, created_at)
            VALUES (?, ?, 'assistant', ?, ?, ?)
            """,
            (answer_id, workspace_id, answer, request.model, created_at),
        )
    return {
        "question": {
            "id": question_id,
            "role": "user",
            "content": question,
            "model": request.model,
            "created_at": created_at,
        },
        "answer": {
            "id": answer_id,
            "role": "assistant",
            "content": answer,
            "model": request.model,
            "created_at": created_at,
        },
    }


@router.delete("/api/workspaces/{workspace_id}/ai/messages")
def clear_workspace_ai_messages(workspace_id: str) -> dict[str, str]:
    get_workspace(workspace_id)
    with connect_database() as connection:
        connection.execute("DELETE FROM workspace_ai_messages WHERE workspace_id = ?", (workspace_id,))
    return {"status": "deleted"}
