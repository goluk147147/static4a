import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import Toasts from './components/Toasts';
import ConfirmDialog from './components/ConfirmDialog';
import './app-extra.css';

// Original app.js checkAssetVersion(): when the admin clicks "Clear Cache & Update
// All Users" the server bumps assetVersion; every browser clears caches and reloads once.
function checkAssetVersion() {
  fetch('/api/version?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => r.json())
    .then((res) => {
      if (!res?.success) return;
      const server = String(res.assetVersion);
      const local = localStorage.getItem('4astore_asset_version');
      localStorage.setItem('4astore_asset_version', server);
      if (local === null || local === server) return; // first visit: just remember it
      const reload = () => window.location.reload();
      if ('caches' in window) caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).finally(reload);
      else reload();
    })
    .catch(() => {});
}
checkAssetVersion();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toasts />
          <ConfirmDialog />
        </BrowserRouter>
      </QueryClientProvider>
    </HelmetProvider>
  </React.StrictMode>
);
