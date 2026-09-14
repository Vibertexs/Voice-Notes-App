import { useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';

/**
 * Answers come from a model running on this machine, over this lecture's own
 * notes and transcripts. Nothing is sent anywhere.
 */
export default function AssistantPanel({ workspace, onReload, notify }) {
  const [status, setStatus] = useState(null);
  const [model, setModel] = useState('');
  const [notes, setNotes] = useState(workspace.ai_notes ?? '');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const threadRef = useRef(null);

  useEffect(() => { setNotes(workspace.ai_notes ?? ''); }, [workspace.ai_notes]);

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

  async function generateNotes() {
    setBusy('notes');
    try {
      const result = await libraryApi.generateNotes(workspace.id, model);
      setNotes(result.note_body);
      notify('AI notes written from this lecture.');
      onReload();
    } catch (caught) { notify(caught.message, 'error'); } finally { setBusy(''); }
  }

  async function saveNotes() {
    try {
      await libraryApi.saveAiNotes(workspace.id, model || status?.default_model || 'local', notes);
      notify('AI notes saved.');
      onReload();
    } catch (caught) { notify(caught.message, 'error'); }
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

  return <section className="assistant-layout">
    <div className="section-heading">
      <div><p className="eyebrow">Runs on this laptop</p><h2>Ask this lecture</h2></div>
      <div className="assistant-controls">
        <label className="sr-only" htmlFor="assistant-model">Local model</label>
        <select
          id="assistant-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={!status?.models?.length}
        >
          {status?.models?.length
            ? status.models.map((name) => <option key={name} value={name}>{name}</option>)
            : <option value="">No local model</option>}
        </select>
        <button className="button primary" onClick={generateNotes} disabled={!ready || busy === 'notes'}>
          {busy === 'notes' ? 'Writing…' : 'Write AI notes'}
        </button>
      </div>
    </div>

    {!status ? <p className="muted">Checking for a local model…</p>
      : !status.ready && <p className="assistant-setup">{status.message}</p>}

    <textarea
      className="assistant-notes"
      value={notes}
      maxLength="100000"
      placeholder="Generate notes from this lecture, or write your own."
      onChange={(event) => setNotes(event.target.value)}
      onBlur={saveNotes}
    />

    <div className="assistant-thread" ref={threadRef}>
      {messages.length === 0
        ? <p className="muted">Ask about your own notes and recordings. It will say when they don’t answer.</p>
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
  </section>;
}
