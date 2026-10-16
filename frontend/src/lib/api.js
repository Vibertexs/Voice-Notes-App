const API_ROOT = import.meta.env.VITE_API_ROOT ?? '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  const isJson = options.body && !(options.body instanceof FormData) && typeof options.body !== 'string';
  if (isJson) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers,
    body: isJson ? JSON.stringify(options.body) : options.body,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new ApiError(body?.detail ?? 'Something went wrong. Please try again.', response.status);
  return body;
}

export const libraryApi = {
  library: (folderId, { archived = false } = {}) => {
    const params = new URLSearchParams();
    if (folderId) params.set('folder_id', folderId);
    if (archived) params.set('archived', 'true');
    return api(`/api/library${params.size ? `?${params}` : ''}`);
  },
  allFolders: () => api('/api/folders'),
  createFolder: (folder) => api('/api/folders', { method: 'POST', body: folder }),
  updateFolder: (id, update) => api(`/api/folders/${id}`, { method: 'PATCH', body: update }),
  archiveFolder: (id, archived) => api(`/api/folders/${id}`, { method: 'PATCH', body: { archived } }),
  deleteFolder: (id) => api(`/api/folders/${id}`, { method: 'DELETE' }),
  workspace: (id) => api(`/api/workspaces/${id}`),
  updateWorkspace: (id, update) => api(`/api/workspaces/${id}`, { method: 'PATCH', body: update }),
  deleteWorkspace: (id) => api(`/api/workspaces/${id}`, { method: 'DELETE' }),
  saveNotes: (id, noteBody) => api(`/api/workspaces/${id}/notes`, { method: 'PUT', body: { note_body: noteBody } }),
  saveStudyNotes: (id, noteBody) => api(`/api/workspaces/${id}/study-notes`, { method: 'PUT', body: { note_body: noteBody } }),
  generateStudyNotes: (id) => api(`/api/workspaces/${id}/study-notes/generate`, { method: 'POST' }),
  generateFlashcards: (id) => api(`/api/workspaces/${id}/flashcards/generate`, { method: 'POST' }),
  uploadMaterial: (file, { folderId, workspaceId } = {}) => {
    const params = new URLSearchParams();
    if (folderId) params.set('folder_id', folderId);
    if (workspaceId) params.set('workspace_id', workspaceId);
    const form = new FormData();
    form.append('material', file);
    return api(`/api/materials${params.size ? `?${params}` : ''}`, { method: 'POST', body: form });
  },
  deleteMaterial: (id) => api(`/api/materials/${id}`, { method: 'DELETE' }),
  addMarker: (lectureId, marker) => api(`/api/lectures/${lectureId}/markers`, { method: 'POST', body: marker }),
  deleteMarker: (lectureId, markerId) => api(`/api/lectures/${lectureId}/markers/${markerId}`, { method: 'DELETE' }),
  retranscribe: (lectureId) => api(`/api/lectures/${lectureId}/retranscribe`, { method: 'POST' }),
  generateNotes: (workspaceId, model) => api(`/api/workspaces/${workspaceId}/ai/notes`, { method: 'POST', body: { model } }),
  askQuestion: (workspaceId, model, question) => api(`/api/workspaces/${workspaceId}/ai/questions`, { method: 'POST', body: { model, question } }),
  aiStatus: () => api('/api/ai/status'),
  search: (query) => api(`/api/search?q=${encodeURIComponent(query)}`),
  aiMessages: (workspaceId) => api(`/api/workspaces/${workspaceId}/ai/messages`),
  clearAiMessages: (workspaceId) => api(`/api/workspaces/${workspaceId}/ai/messages`, { method: 'DELETE' }),
  saveAiNotes: (workspaceId, model, noteBody) => api(`/api/workspaces/${workspaceId}/ai/notes`, { method: 'PUT', body: { model, note_body: noteBody } }),
};

/**
 * The account, answered by the phone shell (mobile/src/cloudSync.js), which
 * talks to the cloud API. The desktop server has no such route: a 404 from
 * status() means "this build does not sync", not an error.
 */
export const accountApi = {
  status: () => api('/api/account'),
  register: (email, password) => api('/api/account/register', { method: 'POST', body: { email, password } }),
  login: (email, password) => api('/api/account/login', { method: 'POST', body: { email, password } }),
  google: () => api('/api/account/google', { method: 'POST' }),
  forgot: (email) => api('/api/account/forgot', { method: 'POST', body: { email } }),
  reset: (email, code, password) => api('/api/account/reset', { method: 'POST', body: { email, code, password } }),
  logout: () => api('/api/account/logout', { method: 'POST' }),
  tokens: () => api('/api/account/tokens'),
  createToken: (name) => api('/api/account/tokens', { method: 'POST', body: { name } }),
  revokeToken: (id) => api(`/api/account/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  remove: (password) => api('/api/account/delete', { method: 'POST', body: { password } }),
};

export async function uploadRecording({ blob, title, captureNotes, folderId, workspaceId }) {
  const form = new FormData();
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('audio', blob, `lecture.${extension}`);
  form.append('title', title);
  form.append('capture_notes', captureNotes);
  // Final transcription is intentionally fixed at the product's quality-first model.
  form.append('model', 'small.en');
  if (workspaceId) form.append('workspace_id', workspaceId);
  else form.append('create_workspace', 'true');
  if (folderId) form.append('folder_id', folderId);
  return api('/api/lectures', { method: 'POST', body: form });
}
