import { useEffect, useRef, useState } from 'react';
import VFSearchField from '../components/VFSearchField';
import { Icon } from '../components/Icon';
import { COPY, fill } from '../lib/copy';
import { dateLabel, mmss } from '../lib/format';
import { accountApi, libraryApi } from '../lib/api';

const RECENTS_KEY = 'vf.recent-searches';
const MEANING_KEY = 'vf.search-by-meaning';

function readRecents() {
  try { return JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]').slice(0, 8); }
  catch { return []; }
}

/** On unless the person has turned it off. Like recents, a convenience: unavailable storage means "on". */
function readMeaning() {
  try { return window.localStorage.getItem(MEANING_KEY) !== 'off'; }
  catch { return true; }
}

/** Wraps every occurrence of the term so the reason a result matched is visible. */
function Highlighted({ text, term }) {
  if (!term) return text;
  const parts = String(text).split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((part, i) => (
    part.toLowerCase() === term.toLowerCase() ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
  ));
}

function ResultList({ items, term, onOpen, folderOf }) {
  return (
    <ul className="results">
      {items.map((result) => (
        <li key={`${result.lecture_id}-${result.start_seconds ?? 'x'}`}>
          <button type="button" className="result" onClick={() => onOpen(result)}>
            <strong>{result.title || result.workspace_title}</strong>
            <span className="result-meta">
              {folderOf(result) && <i className="result-dot" data-tone={folderOf(result).color} />}
              {[folderOf(result)?.name, dateLabel(result.created_at)].filter(Boolean).join(' · ')}
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
  );
}

/**
 * Search across everything.
 *
 * It searches what was said, not just what things are called, which is why a
 * result is a card with a snippet rather than a row with a title: the useful
 * part of the answer is the sentence, and the timestamp is how you get to it.
 *
 * Below the exact matches, when signed in and online, passages that mean the same
 * thing are offered too ("bread" finds the lecture about sandwiches). They come
 * from the server, which holds the transcripts, and are a bonus: if the call fails
 * or nothing is close enough, the section is simply absent. A pill under the search
 * box turns them off for people who only want exact matches (each one is a metered
 * request); the choice is remembered on this device.
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
  const [similar, setSimilar] = useState([]);
  const [similarState, setSimilarState] = useState('idle');   // idle | loading | done
  const [meaning, setMeaning] = useState(readMeaning);
  const [recents, setRecents] = useState(readRecents);
  const ticket = useRef(0);
  const similarTicket = useRef(0);

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

  // Slower than the exact search: each one is a round trip and a (tiny) metered
  // embedding, so it waits for a pause in typing and for a word worth meaning-matching.
  useEffect(() => {
    const mine = ++similarTicket.current;
    if (!meaning || term.length < 3) { setSimilar([]); setSimilarState('idle'); return undefined; }
    setSimilarState('loading');
    const timer = window.setTimeout(async () => {
      try {
        const found = await accountApi.similar(term);
        if (mine !== similarTicket.current) return;
        setSimilar(found.results ?? []);
      } catch {
        if (mine !== similarTicket.current) return;
        setSimilar([]);        // signed out, offline, off or still being set up: no section, no error
      }
      setSimilarState('done');
    }, 650);
    return () => window.clearTimeout(timer);
  }, [term, meaning]);

  const toggleMeaning = () => {
    const next = !meaning;
    setMeaning(next);
    try { window.localStorage.setItem(MEANING_KEY, next ? 'on' : 'off'); } catch { /* private mode */ }
  };

  // A recording that already matched the words is not offered again as "similar".
  const seen = new Set(results.map((result) => result.workspace_id));
  const related = similar
    .filter((passage) => !seen.has(passage.recordingId))
    .map((passage) => ({
      lecture_id: passage.recordingId, workspace_id: passage.recordingId, folder_id: passage.folderId ?? null,
      title: passage.title, created_at: passage.createdAt, start_seconds: passage.startSeconds,
      excerpt: passage.passage.length > 180 ? `${passage.passage.slice(0, 180).trimEnd()}…` : passage.passage,
    }));

  const remember = (text) => {
    const next = [text, ...recents.filter((entry) => entry !== text)].slice(0, 8);
    setRecents(next);
    try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const open = (result, highlight = term) => { remember(term); onOpenResult(result, highlight); };

  const folderOf = (result) => folders.find((folder) => folder.id === result.folder_id);

  return (
    <main className="screen screen--search">
      <header className="vf-head">
        <button type="button" className="vf-round vf-round--plain" aria-label="Back" onClick={onBack}>
          <Icon name="back" strokeWidth={2.2} />
        </button>
      </header>
      <VFSearchField
        className="search-bar"
        autoFocus value={query} onChange={setQuery}
        placeholder="Search recordings & transcripts" label={COPY.searchHint}
        onSubmit={() => document.activeElement?.blur?.()}
      />

      <div className="chips search-options">
        <button type="button" className="meaning-toggle" role="switch" aria-checked={meaning} onClick={toggleMeaning}>
          Also match by meaning
          <span className="meaning-switch" aria-hidden="true" />
        </button>
      </div>

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

      {term && results.length > 0 && <ResultList items={results} term={term} onOpen={open} folderOf={folderOf} />}

      {term && related.length > 0 && (
        <section className="vf-section">
          <h2 className="vf-label">Similar in meaning</h2>
          <ResultList items={related} term="" onOpen={(result) => open(result, '')} folderOf={folderOf} />
        </section>
      )}

      {term && searched && !results.length && !related.length && similarState !== 'loading' && (
        <div className="vf-empty">
          <strong>{COPY.noResTitle}</strong>
          <p>{note || fill(COPY.noResSub, { q: term })}</p>
        </div>
      )}
    </main>
  );
}
