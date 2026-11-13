import { useRef, useState, type DragEvent } from 'react';
import { useApp } from '../app/AppContext';
import type { Asset } from '../domain/types';
import { config } from '../config';
import { importImageFile, type ImportTarget } from '../features/assets/importFile';
import { ACCEPT_ATTR, formatBytes } from '../features/assets/validation';
import { Modal } from './Modal';
import { useToast } from './Toast';

interface Props {
  target: ImportTarget;
  label: string;
  onImported: (assets: Asset[]) => void;
  compact?: boolean;
  multiple?: boolean;
}

/** Import depuis l'appareil : sélection ou glisser-déposer. Validation avant tout enregistrement. */
export function Importer({ target, label, onImported, compact = false, multiple = true }: Props) {
  const { repo } = useApp();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [tooLarge, setTooLarge] = useState<{ file: File; message: string }[]>([]);
  const [over, setOver] = useState(false);

  async function run(files: File[], optimize = false) {
    if (files.length === 0) return;
    const imported: Asset[] = [];
    const errs: string[] = [];
    const large: { file: File; message: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(files.length > 1 ? `Import ${i + 1} sur ${files.length} : ${files[i].name}` : `Import de ${files[i].name}…`);
      try {
        const out = await importImageFile(repo, files[i], target, { optimize });
        if (out.status === 'imported') imported.push(out.asset);
        else if (out.status === 'rejected') errs.push(out.message);
        else large.push({ file: out.file, message: out.message });
      } catch (e) {
        errs.push(`« ${files[i].name} » n’a pas été enregistrée : ${(e as Error).message}`);
      }
    }
    setBusy(null);
    setErrors(errs);
    setTooLarge(large);
    if (imported.length) {
      toast('success', imported.length > 1 ? `${imported.length} images importées.` : `« ${imported[0].title} » importée.`);
      onImported(imported);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    void run([...e.dataTransfer.files]);
  }

  return (
    <div
      className={`importer${compact ? ' importer-compact' : ''}${over ? ' is-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void run(files);
        }}
      />
      <button type="button" className="button" disabled={!!busy} onClick={() => input.current?.click()}>
        {label}
      </button>
      {!compact && (
        <span className="importer-hint">
          ou dépose les fichiers ici. JPG, PNG ou WebP, {formatBytes(config.maxUploadBytes)} maximum. Un PNG ou WebP détouré (fond transparent) s’insère mieux dans un décor.
        </span>
      )}
      {busy && <p className="importer-progress" role="status"><span className="spinner" aria-hidden="true" /> {busy}</p>}
      {errors.length > 0 && (
        <div className="error-box" role="alert">
          <p>Non importé :</p>
          <ul>{errors.map((m) => <li key={m}>{m}</li>)}</ul>
          <button type="button" className="link-button" onClick={() => setErrors([])}>Masquer</button>
        </div>
      )}
      {tooLarge.length > 0 && (
        <Modal
          title="Fichier trop volumineux"
          onClose={() => setTooLarge([])}
          actions={
            <>
              <button type="button" className="button" onClick={() => setTooLarge([])}>Ne pas importer</button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  const files = tooLarge.map((t) => t.file);
                  setTooLarge([]);
                  void run(files, true);
                }}
              >
                Importer une version optimisée
              </button>
            </>
          }
        >
          {tooLarge.map((t) => <p key={t.file.name}>{t.message}</p>)}
          <p>
            La version optimisée est réduite à 3000 px sur le plus grand côté. C’est elle qui sera enregistrée dans le laboratoire ; ton fichier d’origine reste intact sur ton appareil.
          </p>
        </Modal>
      )}
    </div>
  );
}
