import { useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';
import FlashcardDeck from './FlashcardDeck';

/**
 * Revision, in one place: cards to test yourself, a way to pull in notes you
 * wrote elsewhere, and somewhere to ask about this lecture. Writing lives in
 * the Notes tab, so there is no second editor here to keep in sync.
 */
export default function StudyPanel({ workspace, onReload, notify }) {
  const [status, setStatus] = useState(null);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const threadRef = useRef(null);
  const importRef = useRef(null);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [state, thread] = await Promise.all([
          libraryApi.aiStatus(),
          libraryApi.aiMessages(workspace.id),
        ]);
        if (cancelled) return;
        setStatus(state);
        setModel((current) => current || state.models?.[0] || state.default_model || '');
        setMessages(thread.messages ?? []);
      } catch (caught) {
        if (!cancelled) setStatus({ ready: false, message: caught.message, models: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [workspace.id]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const ready = Boolean(status?.ready && model);




  async function importNotes(files) {
    const chosen = [...(files ?? [])];
    if (!chosen.length) return;
    setImporting(true);
    try {
      await Promise.all(chosen.map((file) => libraryApi.uploadMaterial(file, { workspaceId: workspace.id })));
      notify(`${chosen.length} file${chosen.length === 1 ? '' : 's'} added to this lecture.`);
      onReload();
    } catch (caught) {
      notify(caught.message, 'error');
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function ask(event) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked || !ready) return;
    setBusy('ask');
    setQuestion('');
    try {
      const result = await libraryApi.askQuestion(workspace.id, model, asked);
      setMessages((current) => [...current, result.question, result.answer]);
    } catch (caught) {
      notify(caught.message, 'error');
      setQuestion(asked);
    } finally { setBusy(''); }
  }

  async function clearThread() {
    if (!messages.length || !window.confirm('Clear these questions?')) return;
    try { await libraryApi.clearAiMessages(workspace.id); setMessages([]); }
    catch (caught) { notify(caught.message, 'error'); }
  }

  return <section className="study-panel glass-card">
    <div className="section-heading">
      <h2>Study</h2>
    </div>

    <FlashcardDeck workspace={workspace} onReload={onReload} notify={notify} />

    <section className="study-import">
      <div className="section-heading">
        <h3>Bring in notes</h3>
      </div>
      <p className="muted">
        Already wrote these somewhere else? Drop a PDF, a Word doc, slides or a
        Markdown export straight in. They join this lecture and the assistant can read them.
      </p>
      <button
        className={`import-drop ${dragging ? 'dragging' : ''}`}
        onClick={() => importRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); importNotes(event.dataTransfer.files); }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <strong>{importing ? 'Importing…' : 'Drop notes here, or choose a file'}</strong>
        <span>PDF · Word · PowerPoint · Markdown · plain text</span>
      </button>
      <input
        ref={importRef}
        hidden
        type="file"
        multiple
        accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx"
        onChange={(event) => importNotes(event.target.files)}
      />
    </section>

    <div className="study-ask">
      <div className="section-heading">
        <h3>Ask this lecture</h3>
        {status?.models?.length > 0 && <>
          <label className="sr-only" htmlFor="study-model">Local model</label>
          <select id="study-model" value={model} onChange={(event) => setModel(event.target.value)}>
            {status.models.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </>}
      </div>

      <div className="assistant-thread" ref={threadRef}>
        {messages.length === 0
          ? <p className="muted">Ask about this lecture.</p>
          : messages.map((message) => (
            <p key={message.id} className={`assistant-message ${message.role}`}>
              <span className="assistant-role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
              {message.content}
            </p>
          ))}
      </div>

      <form className="assistant-ask" onSubmit={ask}>
        <textarea
          rows="2"
          value={question}
          maxLength="4000"
          placeholder={ready ? 'e.g. What should I know for the quiz?' : 'Start a local model to ask questions'}
          disabled={!ready || busy === 'ask'}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button className="button primary" type="submit" disabled={!ready || busy === 'ask' || !question.trim()}>
          {busy === 'ask' ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {messages.length > 0 && <button className="text-button" onClick={clearThread}>Clear questions</button>}
    </div>
  </section>;
}
