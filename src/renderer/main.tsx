import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const route = window.location.hash.replace(/^#/, '');

async function boot(): Promise<void> {
  if (route === 'render') {
    const { runRenderRoute } = await import('./routes/render');
    await runRenderRoute();
    return;
  }
  const root = createRoot(document.getElementById('root')!);
  const { App } = await import('./App');
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
