import { useEffect, useRef, useState } from 'react';
import VFSearchField from '../components/VFSearchField';
import { Icon } from '../components/Icon';
import { COPY, fill } from '../lib/copy';
import { dateLabel, mmss } from '../lib/format';
import { libraryApi } from '../lib/api';

const RECENTS_KEY = 'vf.recent-searches';

function readRecents() {
  try { return JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]').slice(0, 8); }
  catch { return []; }
}

/** Wraps every occurrence of the term so the reason a result matched is visible. */
function Highlighted({ text, term }) {
  if (!term) return text;
  const parts = String(text).split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((part, i) => (
    part.toLowerCase() === term.toLowerCase() ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
  ));
}

/**
 * Search across everything.
 *
 * It searches what was said, not just what things are called, which is why a
 * result is a card with a snippet rather than a row with a title: the useful
 * part of the answer is the sentence, and the timestamp is how you get to it.
 *
 * Recent searches are kept per device in localStorage. They are a convenience,
 * not data - if the store is unavailable the screen still works, it just
 * offers nothing to tap.
 */
export default function SearchScreen({ onBack, onOpenResult, folders = [] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [note, setNote] = useState('');
  const [recents, setRecents] = useState(readRecents);
  const ticket = useRef(0);

  const term = query.trim();

  useEffect(() => {
    if (!term) { ticket.current += 1; setResults([]); setSearched(false); setNote(''); return undefined; }
    const mine = ++ticket.current;
    const timer = window.setTimeout(async () => {
      try {
        const found = await libraryApi.search(term);
        if (mine !== ticket.current) return;
        setResults(found.results ?? []);
        setSearched(true);
        setNote('');
      } catch (caught) {
        if (mine === ticket.current) { setResults([]); setSearched(true); setNote(caught.message); }
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [term]);

  const remember = (text) => {
    const next = [text, ...recents.filter((entry) => entry !== text)].slice(0, 8);
    setRecents(next);
    try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const open = (result) => { remember(term); onOpenResult(result, term); };

  const folderName = (result) => folders.find((folder) => folder.id === result.folder_id)?.name;

  return (
    <main className="screen screen--search">
      <header className="vf-bar">
        <button type="button" className="vf-round vf-round--plain" aria-label="Back" onClick={onBack}>
          <Icon name="back" strokeWidth={2.2} />
        </button>
        <VFSearchField
          autoFocus value={query} onChange={setQuery}
          placeholder="Search recordings & transcripts" label={COPY.searchHint}
        />
      </header>

      {!term && recents.length > 0 && (
        <section className="vf-section">
          <h2 className="vf-label">Recent</h2>
          <div className="chips">
            {recents.map((entry) => (
              <button key={entry} type="button" className="chip" onClick={() => setQuery(entry)}>{entry}</button>
            ))}
          </div>
        </section>
      )}

      {!term && <p className="vf-empty-line">{COPY.searchHint}</p>}

      {term && results.length > 0 && (
        <ul className="results">
          {results.map((result) => (
            <li key={`${result.lecture_id}-${result.start_seconds ?? 'x'}`}>
              <button type="button" className="result" onClick={() => open(result)}>
                <strong>{result.title || result.workspace_title}</strong>
                <span className="result-meta">
                  {[folderName(result), dateLabel(result.created_at)].filter(Boolean).join(' · ')}
                </span>
                {result.start_seconds != null && (
                  <span className="result-at">{mmss(result.start_seconds)}</span>
                )}
                {Boolean(result.excerpt) && (
                  <span className="result-snippet"><Highlighted text={result.excerpt} term={term} /></span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {term && searched && !results.length && (
        <div className="vf-empty">
          <strong>{COPY.noResTitle}</strong>
          <p>{note || fill(COPY.noResSub, { q: term })}</p>
        </div>
      )}
    </main>
  );
}
