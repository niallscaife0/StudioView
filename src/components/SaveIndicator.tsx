export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  return (
    <span className={`save-state save-${state}`} role="status" aria-live="polite">
      {state === 'saved' && 'Enregistré'}
      {state === 'dirty' && 'Modifications non enregistrées'}
      {state === 'saving' && 'Enregistrement…'}
      {state === 'error' && (
        <>
          Non synchronisé{' '}
          <button type="button" className="link-button" onClick={onRetry}>Réessayer</button>
        </>
      )}
    </span>
  );
}
