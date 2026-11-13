import { useEffect, useState } from 'react';
import { useApp } from '../app/AppContext';

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Banners() {
  const { repo } = useApp();
  const online = useOnline();
  return (
    <>
      {repo.mode === 'local' && (
        <p className="banner banner-local">
          Mode démo local : les données restent dans ce navigateur, sans synchronisation ni sauvegarde distante.
        </p>
      )}
      {repo.mode === 'supabase' && !online && (
        <p className="banner banner-offline" role="alert">
          Hors ligne. Les enregistrements échoueront ; ce qui est à l’écran reste en place jusqu’au retour du réseau.
        </p>
      )}
    </>
  );
}
