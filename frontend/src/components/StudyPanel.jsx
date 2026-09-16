import { useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';
import { Icon } from './Icon';

/**
 * Revision, in one place: a way to pull in notes written elsewhere, and
 * somewhere to ask about this lecture. Writing lives in the Notes panel and
 * cards live in the deck, so neither is duplicated here.
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
      notify(`${chosen.length} file${chosen.length === 1 ? '' : 's'} added.`);
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

  return <>
    <section className="panel">
      <div className="panel-head"><h2 className="panel-title">Bring in notes</h2></div>
      <button
        className={`dropzone ${dragging ? 'over' : ''}`}
        onClick={() => importRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); importNotes(event.dataTransfer.files); }}
      >
        <Icon name="upload" />
        <strong>{importing ? 'Importing…' : 'Drop notes, or choose a file'}</strong>
        <span>PDF · Word · PowerPoint · Markdown · plain text</span>
      </button>
      <input
        ref={importRef} hidden type="file" multiple
        accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx"
        onChange={(event) => importNotes(event.target.files)}
      />
    </section>

    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Ask this lecture</h2>
        {status?.models?.length > 0 && <>
          <label className="sr-only" htmlFor="study-model">Local model</label>
          <select
            id="study-model"
            className="field"
            style={{ width: 'auto', padding: '.35rem .5rem', fontSize: '.78rem' }}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {status.models.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </>}
      </div>

      <div className="thread" ref={threadRef}>
        {messages.length === 0
          ? <p className="dim">Ask anything about this lecture.</p>
          : messages.map((message) => (
            <p key={message.id} className={`msg ${message.role}`}>
              <span className="msg-role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
              {message.content}
            </p>
          ))}
      </div>

      <form className="ask" onSubmit={ask}>
        <textarea
          className="field"
          rows="2"
          value={question}
          maxLength="4000"
          placeholder={ready ? 'e.g. What should I know for the quiz?' : 'Start a local model to ask questions'}
          disabled={!ready || busy === 'ask'}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button className="btn primary" type="submit" disabled={!ready || busy === 'ask' || !question.trim()}>
          {busy === 'ask' ? '…' : 'Ask'}
        </button>
      </form>
      {messages.length > 0 && (
        <button className="linkbtn" style={{ marginTop: '.6rem' }} onClick={clearThread}>Clear questions</button>
      )}
    </section>
  </>;
}
