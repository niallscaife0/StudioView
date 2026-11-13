import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLoad } from '../../app/useLoad';
import { useToast } from '../../components/Toast';
import type { RoomInput } from '../../data/repository';
import type { LightPreset, Room } from '../../domain/types';
import { ROOM_DEFAULTS, ROOM_LIMITS, formatCm } from './geometry';

const LIGHT_LABEL: Record<LightPreset, string> = { bright: 'Galerie claire', day: 'Lumière du jour', dark: 'Salle sombre' };

function RoomForm({ initial, submitLabel, onSubmit, onCancel }: { initial: RoomInput; submitLabel: string; onSubmit: (r: RoomInput) => Promise<void>; onCancel: () => void }) {
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  const num = (k: 'lengthCm' | 'widthCm' | 'heightCm', label: string, max: number) => (
    <label>
      {label} (cm)
      <input type="number" inputMode="numeric" min={ROOM_LIMITS.min} max={max} step={10} value={r[k]} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} required />
    </label>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await onSubmit(r); } finally { setBusy(false); }
  }
  return (
    <form className="room-form" onSubmit={submit}>
      <label className="room-form-title">Nom de la salle<input value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} placeholder="Galerie" /></label>
      {num('lengthCm', 'Longueur', ROOM_LIMITS.max)}
      {num('widthCm', 'Largeur', ROOM_LIMITS.max)}
      {num('heightCm', 'Hauteur sous plafond', 2000)}
      <label>Murs<input type="color" value={r.wallColor} onChange={(e) => setR({ ...r, wallColor: e.target.value })} /></label>
      <label>Sol<input type="color" value={r.floorColor} onChange={(e) => setR({ ...r, floorColor: e.target.value })} /></label>
      <label>Lumière
        <select value={r.light} onChange={(e) => setR({ ...r, light: e.target.value as LightPreset })}>
          {(Object.keys(LIGHT_LABEL) as LightPreset[]).map((k) => <option key={k} value={k}>{LIGHT_LABEL[k]}</option>)}
        </select>
      </label>
      <div className="button-row">
        <button type="submit" className="button button-primary" disabled={busy}>{submitLabel}</button>
        <button type="button" className="button" onClick={onCancel} disabled={busy}>Annuler</button>
      </div>
    </form>
  );
}

const toInput = (r: Room): RoomInput => ({ title: r.title, lengthCm: r.lengthCm, widthCm: r.widthCm, heightCm: r.heightCm, wallColor: r.wallColor, floorColor: r.floorColor, light: r.light });

/** Salles paramétrables et accrochages (F-37, F-43). */
export function HangingsPage() {
  const { repo } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(() => Promise.all([repo.listRooms(), repo.listPresentations(), repo.listVariants()]), [repo]);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (loading && !data) return <p className="page-state" role="status">Chargement…</p>;
  if (error)
    return (
      <section className="page">
        <p className="error-box" role="alert">{error}</p>
        <button type="button" className="button" onClick={reload}>Réessayer</button>
      </section>
    );
  const [rooms, presentations, variants] = data!;
  const hangings = presentations.filter((p) => p.mode === 'room');

  async function createHanging(room: Room) {
    try {
      const n = hangings.filter((h) => h.roomId === room.id).length + 1;
      const p = await repo.createHanging(room.id, `Accrochage ${n}`);
      const v = await repo.createVariant({ presentationId: p.id, name: 'A', backgroundAssetId: null, items: [], placements: [] });
      navigate(`/accrochages/${p.id}?variant=${v.id}`);
    } catch (e) {
      toast('error', `Accrochage non créé : ${(e as Error).message}`);
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>Accrochages</h1>
        {!creatingRoom && <button type="button" className="button button-primary" onClick={() => setCreatingRoom(true)}>Nouvelle salle</button>}
      </div>
      <p className="muted">Une salle a des dimensions réelles. Un accrochage y dispose plusieurs œuvres à leur hauteur déclarée ; tu peux ensuite t’y déplacer.</p>

      {creatingRoom && (
        <RoomForm
          initial={{ title: '', ...ROOM_DEFAULTS }}
          submitLabel="Créer la salle"
          onCancel={() => setCreatingRoom(false)}
          onSubmit={async (r) => {
            try {
              await repo.createRoom(r);
              setCreatingRoom(false);
              toast('success', 'Salle créée.');
              reload();
            } catch (e) {
              toast('error', `Salle non créée : ${(e as Error).message}`);
            }
          }}
        />
      )}

      {rooms.length === 0 && !creatingRoom && (
        <p className="empty">Aucune salle. Crée-en une avec ses dimensions : par exemple 8 m sur 6 m, 3,50 m sous plafond.</p>
      )}

      {rooms.map((room) => {
        const own = hangings.filter((h) => h.roomId === room.id);
        return (
          <section key={room.id} className="block room-block">
            <div className="block-head">
              <h2>
                <span className="swatch" style={{ background: room.wallColor }} aria-hidden="true" />
                <span className="swatch" style={{ background: room.floorColor }} aria-hidden="true" />
                {room.title}
                <span className="muted room-dims"> {formatCm(room.lengthCm)} × {formatCm(room.widthCm)}, plafond {formatCm(room.heightCm)}, {LIGHT_LABEL[room.light].toLowerCase()}</span>
              </h2>
              <div className="button-row">
                <button type="button" className="button button-primary" onClick={() => createHanging(room)}>Nouvel accrochage</button>
                <button type="button" className="button" onClick={() => setEditing(editing === room.id ? null : room.id)}>Modifier la salle</button>
                <button
                  type="button"
                  className="link-button danger-text"
                  onClick={async () => {
                    if (!window.confirm(`Supprimer la salle « ${room.title} » ?`)) return;
                    try {
                      await repo.deleteRoom(room.id);
                      toast('success', 'Salle supprimée.');
                      reload();
                    } catch (e) {
                      toast('error', (e as Error).message);
                    }
                  }}
                >
                  Supprimer
                </button>
              </div>
            </div>
            {editing === room.id && (
              <RoomForm
                initial={toInput(room)}
                submitLabel="Enregistrer la salle"
                onCancel={() => setEditing(null)}
                onSubmit={async (r) => {
                  try {
                    await repo.updateRoom(room.id, r);
                    setEditing(null);
                    toast('success', 'Salle enregistrée.');
                    reload();
                  } catch (e) {
                    toast('error', `Salle non enregistrée : ${(e as Error).message}`);
                  }
                }}
              />
            )}
            {own.length === 0 ? (
              <p className="muted">Aucun accrochage dans cette salle.</p>
            ) : (
              <ul className="pres-list">
                {own.map((h) => {
                  const vs = variants.filter((v) => v.presentationId === h.id);
                  const n = Math.max(0, ...vs.map((v) => v.placements.length));
                  return (
                    <li key={h.id}>
                      <Link to={`/accrochages/${h.id}`}>{h.title}</Link>
                      <span className="muted"> {vs.map((v) => v.name).join(', ') || 'aucune variante'}, {n} œuvre{n > 1 ? 's' : ''} placée{n > 1 ? 's' : ''}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}
