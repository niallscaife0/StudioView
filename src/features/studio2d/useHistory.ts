import { useCallback, useRef, useState } from 'react';
import type { VariantDraft } from '../../domain/types';
import { sameDraft } from '../../domain/transform';

/**
 * État éditable du Studio avec historique d'annulation (session uniquement).
 * Les changements rapprochés (< 400 ms, ex. un glissement) forment une seule étape.
 */
export function useDraftHistory(initial: VariantDraft) {
  const [draft, setDraft] = useState<VariantDraft>(initial);
  const past = useRef<VariantDraft[]>([]);
  const lastPush = useRef(0);
  const [canUndo, setCanUndo] = useState(false);

  const update = useCallback((next: VariantDraft | ((d: VariantDraft) => VariantDraft), coalesce = true) => {
    setDraft((cur) => {
      const value = typeof next === 'function' ? next(cur) : next;
      if (sameDraft(cur, value)) return cur;
      const now = Date.now();
      if (!coalesce || now - lastPush.current > 400) {
        past.current.push(cur);
        if (past.current.length > 100) past.current.shift();
      }
      lastPush.current = now;
      setCanUndo(true);
      return value;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev) setDraft(prev);
    lastPush.current = 0;
    setCanUndo(past.current.length > 0);
  }, []);

  /** Remplace l'état sans historique (chargement d'une variante). */
  const reset = useCallback((value: VariantDraft) => {
    past.current = [];
    lastPush.current = 0;
    setCanUndo(false);
    setDraft(value);
  }, []);

  /** Termine une étape : le prochain changement ouvrira une nouvelle entrée. */
  const commit = useCallback(() => {
    lastPush.current = 0;
  }, []);

  return { draft, update, undo, reset, commit, canUndo };
}
