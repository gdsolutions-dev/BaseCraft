import '@fontsource-variable/inter';
import './theme.css';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App';
import { i18n } from './i18n';
import { trackShift } from './shell/shift-key';

trackShift(window); // B3 R4: Shift held at an opening bypasses the base's startup

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>,
);
