import { useCallback, useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';

const formatTime = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The server wraps matches in ‹ ›, so the text renders without dangerouslySetInnerHTML.
function Excerpt({ text }) {
  const parts = String(text ?? '').replace(/\s*\n+\s*/g, ' ').split(/[‹›]/);
  return <span className="search-excerpt">
    {parts.map((part, index) => (part
      ? (index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>)
      : null))}
  </span>;
}

export default function SearchView({ onOpenResult, onBack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('Search every recording, note and attached file.');
  const inputRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      requestRef.current += 1;
      setResults([]);
      setStatus('Search every recording, note and attached file.');
      return;
    }
    const ticket = ++requestRef.current;
    setStatus('Searching…');
    try {
      const data = await libraryApi.search(trimmed);
      if (ticket !== requestRef.current) return; // a newer keystroke won
      setResults(data.results ?? []);
      const moments = (data.results ?? []).filter((item) => item.start_seconds != null).length;
      setStatus(data.results?.length
        ? `${data.results.length} result${data.results.length === 1 ? '' : 's'}${moments ? ` · ${moments} jump straight to a moment` : ''}`
        : `Nothing matched “${trimmed}”.`);
    } catch (caught) {
      if (ticket === requestRef.current) setStatus(caught.message);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => run(query), 220);
    return () => window.clearTimeout(timer);
  }, [query, run]);

  return <main className="page search-page">
    <header className="search-header">
      <button className="back-link" onClick={onBack}>‹ Back to library</button>
      <p className="eyebrow">Across every lecture</p>
      <h2>Search everything</h2>
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        value={query}
        maxLength="120"
        placeholder="e.g. mitosis, exam date, chapter 4"
        onChange={(event) => setQuery(event.target.value)}
      />
    </header>
    <p className="search-status" role="status">{status}</p>
    <ol className="search-results">
      {results.map((result, index) => (
        <li key={`${result.kind}-${result.lecture_id ?? result.workspace_id}-${index}`}>
          <button onClick={() => onOpenResult(result)}>
            <span className="search-result-top">
              <span className="search-kind">{result.kind_label}</span>
              {result.start_seconds != null && (
                <time className="search-stamp">{formatTime(result.start_seconds)}</time>
              )}
              <strong>{result.title}</strong>
              <small>{result.context}</small>
            </span>
            <Excerpt text={result.excerpt} />
          </button>
        </li>
      ))}
    </ol>
  </main>;
}
