import { useMemo, useState } from 'react';
import type { MarketingDashboard } from '../../../lib/admin';

type SubTab = 'dashboard' | 'promotions' | 'banners' | 'festivals' | 'templates' | 'reach' | 'composer' | 'broadcast' | 'links' | 'campaigns' | 'video' | 'autosend';

type NudgeState = 'actedOn' | 'dismissed';

/** Local YYYY-MM-DD (uses the browser's local date, not UTC). */
function localDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const STORAGE_PREFIX = '4astore_marketing_suggestion_';

/** Days from today until an ISO date (negative = past). Null when no date. */
function daysUntil(v: string | null): number | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function readState(key: string): NudgeState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: NudgeState };
    return parsed.state === 'actedOn' || parsed.state === 'dismissed' ? parsed.state : null;
  } catch {
    return null;
  }
}

function writeState(key: string, state: NudgeState) {
  try {
    localStorage.setItem(key, JSON.stringify({ state }));
  } catch {
    /* private mode / storage full — ignore */
  }
}

type Suggestion = { text: string; actionLabel: string; target: SubTab };

export default function MarketingSuggestionNudge({
  recommended,
  onGoto,
}: {
  recommended: MarketingDashboard['recommended'];
  onGoto: (t: SubTab) => void;
}) {
  const storageKey = useMemo(() => `${STORAGE_PREFIX}${localDateKey()}`, []);

  // Day already acted on -> stay hidden for the whole day.
  const [actedOn, setActedOn] = useState<boolean>(() => readState(storageKey) === 'actedOn');
  // Dismissed only hides for this render; it reappears on next mount/reload.
  const [hidden, setHidden] = useState<boolean>(false);

  // First-match-wins suggestion from live dashboard data (no invented values).
  const suggestion = useMemo<Suggestion | null>(() => {
    const festivalSoon = recommended.festivalsSoon.find((f) => {
      const du = daysUntil(f.festival_date);
      return du !== null && du >= 0 && du <= 7;
    });
    if (festivalSoon) {
      return {
        text: '🎊 Aaj festival offer bhejein / Promote a festival offer today',
        actionLabel: '→ Festivals',
        target: 'festivals',
      };
    }
    if (recommended.discountedProducts.length > 0) {
      return {
        text: '🏷️ Aaj apna top discount promote karein / Promote your top discount today',
        actionLabel: '→ Promotions',
        target: 'promotions',
      };
    }
    if (recommended.lowStock.length > 0) {
      return {
        text: '📦 Ye items out of stock hain — restock ya customers ko bataayein / Some items are out of stock',
        actionLabel: '→ Promotions',
        target: 'promotions',
      };
    }
    return null;
  }, [recommended]);

  if (actedOn || hidden || !suggestion) return null;

  function act() {
    writeState(storageKey, 'actedOn');
    setActedOn(true);
    onGoto(suggestion!.target);
  }

  function dismiss() {
    writeState(storageKey, 'dismissed');
    setHidden(true);
  }

  return (
    <div style={nudgeWrap}>
      <span style={nudgeText}>{suggestion.text}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <button type="button" onClick={act} style={btnPrimary}>{suggestion.actionLabel}</button>
        <button type="button" onClick={dismiss} aria-label="Dismiss suggestion / सुझाव हटाएं" title="Dismiss" style={btnDismiss}>✕</button>
      </div>
    </div>
  );
}

/* Inline-style design system (mirrors AdminMarketing.tsx card / btnPrimary / btnGhost). */
const nudgeWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  background: 'var(--primary-light)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '12px 14px',
  boxShadow: 'var(--shadow)',
};
const nudgeText: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--primary-dark)' };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnDismiss: React.CSSProperties = { padding: '7px 10px', background: '#f1f5f9', color: 'var(--gray)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', lineHeight: 1 };
