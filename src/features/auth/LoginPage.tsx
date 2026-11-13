import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../../app/AppContext';

export function LoginPage() {
  const { auth, session } = useApp();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  if (!auth.requiresLogin || session) return <Navigate to="/atelier" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      await auth.requestMagicLink(email);
      setState('sent');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }

  return (
    <main className="login" id="contenu">
      <div className="login-panel">
        <h1>Laboratoire de présentation</h1>
        <p className="login-lead">Connexion à ton espace privé.</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state === 'sending'}
          />
          <button type="submit" className="button button-primary" disabled={state === 'sending' || !email}>
            {state === 'sending' ? 'Envoi…' : 'Recevoir le lien de connexion'}
          </button>
        </form>
        {state === 'sent' && (
          <p className="notice" role="status">
            Si cette adresse est autorisée, un lien de connexion vient d’être envoyé. Ouvre-le dans ce navigateur.
          </p>
        )}
        {state === 'error' && <p className="error-box" role="alert">{error}</p>}
      </div>
    </main>
  );
}
