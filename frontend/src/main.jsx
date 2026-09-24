import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import VFGallery from './components/VFGallery';
import './styles.css';

// TEMPORARY, with VFGallery.jsx: the component sheet is reachable at #gallery
// so it can be checked against the handoff without navigating the app.
const gallery = window.location.hash === '#gallery';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {gallery ? <VFGallery /> : <App />}
  </StrictMode>,
);
