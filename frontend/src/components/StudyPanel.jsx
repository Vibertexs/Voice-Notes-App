import { useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';

/**
 * One study surface. A guide you can draft two ways - instantly from your own
 * notes and transcripts, or with a local model - and a place to ask about them.
 * Everything here runs on this machine.
 */
export default function StudyPanel({ workspace, onReload, notify }) {
  const [status, setStatus] = useState(null);
  const [model, setModel] = useState('');
  const [guide, setGuide] = useState(workspace.study_notes ?? '');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const threadRef = useRef(null);

  useEffect(() => { setGuide(workspace.study_notes ?? ''); }, [workspace.study_notes]);

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

  async function saveGuide() {
    try { await libraryApi.saveStudyNotes(workspace.id, guide); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
  }

  async function draftQuick() {
    setBusy('quick');
    try {
      const result = await libraryApi.generateStudyNotes(workspace.id);
      setGuide(result.note_body);
      notify('Outline drafted from your notes and transcripts.');
      onReload();
    } catch (caught) { notify(caught.message, 'error'); } finally { setBusy(''); }
  }

  async function draftWithAI() {
    setBusy('ai');
    try {
      const result = await libraryApi.generateNotes(workspace.id, model);
      setGuide(result.note_body);
      // Keep one study guide as the source of truth rather than two rival drafts.
      await libraryApi.saveStudyNotes(workspace.id, result.note_body);
      notify('Study guide written by your local model.');
      onReload();
    } catch (caught) { notify(caught.message, 'error'); } finally { setBusy(''); }
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
      <h2>Study guide</h2>
      <div className="study-actions">
        <button className="button ghost" onClick={draftQuick} disabled={busy === 'quick'}>
          {busy === 'quick' ? 'Drafting…' : 'Quick outline'}
        </button>
        <button className="button primary" onClick={draftWithAI} disabled={!ready || busy === 'ai'}>
          {busy === 'ai' ? 'Writing…' : 'Write with AI'}
        </button>
      </div>
    </div>

    {status && !status.ready && <p className="assistant-setup">{status.message}</p>}

    <textarea
      className="assistant-notes"
      value={guide}
      maxLength="100000"
      placeholder="Draft a guide from this lecture, or write your own."
      onChange={(event) => setGuide(event.target.value)}
      onBlur={saveGuide}
    />

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
