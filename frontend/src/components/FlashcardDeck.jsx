import { useEffect, useState } from 'react';
import { libraryApi } from '../lib/api';

export default function FlashcardDeck({ workspace, onReload, notify }) {
  const cards = workspace.flashcards ?? [];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [workspace.id, cards.length]);

  async function generate() {
    setGenerating(true);
    try {
      const result = await libraryApi.generateFlashcards(workspace.id);
      setIndex(0);
      setFlipped(false);
      notify(`${result.flashcards.length} flashcards are ready to review.`);
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
    return <section className="flashcard-deck flashcard-empty">
      <div>
        <p className="eyebrow">Quick review</p>
        <h3>Flashcards</h3>
        <p>Turn the notes and transcript from this lecture into a short review deck.</p>
      </div>
      <button className="button primary" onClick={generate} disabled={generating}>
        {generating ? 'Making cards…' : 'Create flashcards'}
      </button>
    </section>;
  }

  const card = cards[Math.min(index, cards.length - 1)];
  return <section className="flashcard-deck">
    <div className="flashcard-heading">
      <div><p className="eyebrow">Quick review</p><h3>Flashcards</h3></div>
      <button className="text-button" onClick={generate} disabled={generating}>
        {generating ? 'Refreshing…' : 'Refresh cards'}
      </button>
    </div>
    <button
      className={`flashcard ${flipped ? 'flipped' : ''}`}
      onClick={() => setFlipped((current) => !current)}
      aria-pressed={flipped}
      aria-label={flipped ? 'Hide flashcard answer' : 'Show flashcard answer'}
    >
      <span className="flashcard-kicker">{flipped ? 'Answer' : 'Question'}</span>
      <strong>{flipped ? card.back : card.front}</strong>
      <span className="flashcard-tap">{flipped ? 'Tap to see the question' : 'Tap to reveal the answer'}</span>
    </button>
    <div className="flashcard-navigation">
      <button className="icon-button subtle" onClick={() => move(-1)} aria-label="Previous flashcard">‹</button>
      <span>{index + 1} of {cards.length}</span>
      <button className="icon-button subtle" onClick={() => move(1)} aria-label="Next flashcard">›</button>
    </div>
  </section>;
}
