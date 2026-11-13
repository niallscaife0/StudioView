import { useId, useState, type FormEvent } from 'react';
import { useToast } from './Toast';

interface Props {
  value: string;
  label: string;
  onSave: (v: string) => Promise<void>;
  as?: 'h1' | 'span';
}

/** Texte cliquable qui devient un champ ; Entrée enregistre, Échap annule. */
export function InlineRename({ value, label, onSave, as = 'span' }: Props) {
  const toast = useToast();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const Tag = as;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === value) return setEditing(false);
    setBusy(true);
    try {
      await onSave(text);
      setEditing(false);
    } catch (err) {
      toast('error', `Nom non enregistré : ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <Tag className={`rename ${as === 'h1' ? 'rename-title' : ''}`}>
        <button type="button" className="rename-trigger" onClick={() => { setText(value); setEditing(true); }} aria-label={`${label} : ${value}`}>
          {value}
        </button>
      </Tag>
    );
  return (
    <form className="rename-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        autoFocus
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        onBlur={(e) => { if (!busy) void submit(e as unknown as FormEvent); }}
      />
    </form>
  );
}
