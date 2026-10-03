import { useState } from 'react';

// Dependency-free emoji palette (static unicode list, categorized). Clicking an
// emoji calls onPick with the plain unicode character so the caller can insert
// it at the cursor. No external emoji library — these are plain code points that
// round-trip through JSON / FCM push payloads unchanged.
const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: '😀 Smileys',
    emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩', '😇', '🙂', '😉', '😋', '😜', '🤔', '🤗', '😴', '😢', '😭', '😡', '🥳', '😱', '🤯', '🥺', '😏', '😅', '🙃', '😬'],
  },
  {
    label: '👍 Gestures',
    emojis: ['👍', '👎', '👏', '🙌', '🙏', '👋', '🤝', '💪', '✌️', '🤞', '👌', '🤙', '👆', '👇', '👉', '👈', '✋', '🖐️', '✊', '👊'],
  },
  {
    label: '❤️ Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟'],
  },
  {
    label: '🛒 Shopping',
    emojis: ['🛒', '🛍️', '💳', '💰', '💵', '🏷️', '🎁', '📦', '🚚', '🚴', '🏪', '🧾', '✅', '⏰', '🔥', '⭐', '🌟', '💯', '🎯', '📣', '🔔'],
  },
  {
    label: '🥗 Food',
    emojis: ['🥗', '🥦', '🥕', '🍅', '🥔', '🧅', '🧄', '🌽', '🍎', '🍌', '🍊', '🍉', '🍇', '🥭', '🍓', '🥛', '🍞', '🥚', '🍚', '🫘', '🧂', '🫒', '🌶️', '☕'],
  },
  {
    label: '🎉 Festival',
    emojis: ['🎉', '🎊', '🪔', '🎆', '🎇', '🧨', '🕉️', '☪️', '🎄', '🎨', '🏏', '🪢', '🇮🇳', '🌸', '✨', '🙏', '🪁', '🏮'],
  },
];

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(0);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Emoji picker"
        aria-expanded={open}
        title="Emoji daalein"
        style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 15 }}
      >
        😊 Emoji
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Emoji"
          style={{ position: 'absolute', zIndex: 50, top: 'calc(100% + 6px)', left: 0, width: 288, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', padding: 8 }}
        >
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {CATEGORIES.map((c, i) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setCat(i)}
                aria-pressed={cat === i}
                title={c.label}
                style={{ border: 'none', background: cat === i ? 'var(--primary)' : 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 15, padding: '3px 5px', lineHeight: 1 }}
              >
                {c.label.split(' ')[0]}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, maxHeight: 160, overflowY: 'auto' }}>
            {CATEGORIES[cat].emojis.map((e, i) => (
              <button
                key={`${e}-${i}`}
                type="button"
                onClick={() => onPick(e)}
                aria-label={`Insert ${e}`}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, padding: 2, borderRadius: 6 }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
