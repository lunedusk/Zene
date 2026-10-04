import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './routes/AppRouter.js';
import { setThemeMode, getThemeMode } from './theme/theme.js';
import { logger } from './lib/logger.js';
import './theme/tokens.css';

logger.debug('app.bootstrap.start', {});
setThemeMode(getThemeMode());
logger.debug('app.theme.initialized', { mode: getThemeMode() });

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

createRoot(root).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
