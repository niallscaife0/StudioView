import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@fontsource-variable/archivo/standard.css';
import './styles/app.css';
import { AppProvider } from './app/AppContext';
import { createAppRouter } from './app/router';
import { ToastProvider } from './components/Toast';
import { configProblem } from './config';
import { createServices } from './data';

const root = createRoot(document.getElementById('root')!);
const problem = configProblem();

if (problem) {
  root.render(
    <main className="page"><h1>Configuration incomplète</h1><p className="error-box">{problem}</p></main>,
  );
} else {
  createServices()
    .then(({ repo, auth }) =>
      root.render(
        <StrictMode>
          <AppProvider repo={repo} auth={auth}>
            <ToastProvider>
              <RouterProvider router={createAppRouter()} />
            </ToastProvider>
          </AppProvider>
        </StrictMode>,
      ),
    )
    .catch((e: unknown) =>
      root.render(
        <main className="page"><h1>Démarrage impossible</h1><p className="error-box">{(e as Error).message}</p></main>,
      ),
    );
}
