import { useEffect, useState } from 'react';
import { libraryApi } from '../lib/api';
import { Icon } from './Icon';

export default function FlashcardDeck({ workspace, onReload, notify }) {
  const cards = workspace.flashcards ?? [];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { setIndex(0); setFlipped(false); }, [workspace.id, cards.length]);

  async function generate() {
    setGenerating(true);
    try {
      const result = await libraryApi.generateFlashcards(workspace.id);
      setIndex(0);
      setFlipped(false);
      notify(`${result.flashcards.length} flashcards ready.`);
      onReload();
    } catch (caught) {
      notify(caught.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  function move(direction) {
    setIndex((current) => (current + direction + cards.length) % cards.length);
    setFlipped(false);
  }

  if (!cards.length) {
    return <section className="panel">
      <div className="panel-head">
        <div>
          <span className="kicker">Quick review</span>
          <h2 className="panel-title">Flashcards</h2>
        </div>
        <button className="btn primary" onClick={generate} disabled={generating}>
          {generating ? 'Making…' : 'Create'}
        </button>
      </div>
      <p className="dim">Turn this lecture&apos;s notes and transcript into a short review deck.</p>
    </section>;
  }

  const card = cards[Math.min(index, cards.length - 1)];
  return <section className="panel">
    <div className="panel-head">
      <div>
        <span className="kicker">Quick review</span>
        <h2 className="panel-title">Flashcards</h2>
      </div>
      <button className="linkbtn" onClick={generate} disabled={generating}>
        {generating ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>

    <button
      className={`flash ${flipped ? 'flipped' : ''}`}
      onClick={() => setFlipped((current) => !current)}
      aria-pressed={flipped}
      aria-label={flipped ? 'Hide answer' : 'Show answer'}
    >
      <span className="kicker">{flipped ? 'Answer' : 'Question'}</span>
      <strong>{flipped ? card.back : card.front}</strong>
      <span className="flash-tap">{flipped ? 'Tap for the question' : 'Tap to reveal'}</span>
    </button>

    <div className="flash-nav">
      <button className="iconbtn ghost" onClick={() => move(-1)} aria-label="Previous card">
        <Icon name="back" size={16} />
      </button>
      <span>{index + 1} of {cards.length}</span>
      <button className="iconbtn ghost" onClick={() => move(1)} aria-label="Next card">
        <Icon name="back" size={16} className="flip" />
      </button>
    </div>
  </section>;
}
