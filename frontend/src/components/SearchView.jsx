import { useCallback, useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';
import { Icon } from './Icon';

const mmss = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The server wraps matches in ‹ ›, so this renders without dangerouslySetInnerHTML.
function Excerpt({ text }) {
  const parts = String(text ?? '').replace(/\s*\n+\s*/g, ' ').split(/[‹›]/);
  return <span className="result-excerpt">
    {parts.map((part, index) => (part
      ? (index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>)
      : null))}
  </span>;
}

export default function SearchView({ onOpenResult }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  const inputRef = useRef(null);
  const ticketRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      ticketRef.current += 1;
      setResults([]);
      setStatus('');
      return;
    }
    const ticket = ++ticketRef.current;
    setStatus('Searching…');
    try {
      const data = await libraryApi.search(trimmed);
      if (ticket !== ticketRef.current) return; // a newer keystroke won
      const found = data.results ?? [];
      setResults(found);
      const moments = found.filter((item) => item.start_seconds != null).length;
      setStatus(found.length
        ? `${found.length} result${found.length === 1 ? '' : 's'}${moments ? ` · ${moments} jump to a moment` : ''}`
        : `Nothing matched “${trimmed}”.`);
    } catch (caught) {
      if (ticket === ticketRef.current) setStatus(caught.message);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => run(query), 220);
    return () => window.clearTimeout(timer);
  }, [query, run]);

  return <main className="screen">
    <header className="hero-plain">
      <h1 className="display">Search your<br />lectures</h1>

      <div className="searchbar">
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          maxLength="120"
          placeholder="mitosis, exam date, chapter 4…"
          aria-label="Search notes, recordings and files"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button className="iconbtn ghost" onClick={() => setQuery('')} aria-label="Clear search">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      {status && <p className="search-status" role="status">{status}</p>}
    </header>

    <section className="sheet">
      {results.length > 0 ? (
        <ul className="track-list">
          {results.map((result, index) => (
            <li key={`${result.kind}-${result.lecture_id ?? result.workspace_id}-${index}`}>
              <button className="result" onClick={() => onOpenResult(result)}>
                <span className="result-top">
                  <span className="result-kind">{result.kind_label}</span>
                  {result.start_seconds != null && (
                    <time className="result-time">{mmss(result.start_seconds)}</time>
                  )}
                  <span className="result-title">{result.title}</span>
                  <span className="result-ctx">{result.context}</span>
                </span>
                <Excerpt text={result.excerpt} />
              </button>
            </li>
          ))}
        </ul>
      ) : !query.trim() ? (
        <div className="empty">
          <span className="empty-orb"><Icon name="search" /></span>
          <h3>Find anything you said</h3>
          <p>Search across transcripts, notes and imported files at once.</p>
        </div>
      ) : null}
    </section>
  </main>;
}
