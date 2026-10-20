import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import VFGallery from './components/VFGallery';
import './styles.css';

// Development aid: the component sheet (VFGallery.jsx) is reachable at #gallery so the
// components can be checked against the design handoff without navigating the app.
const gallery = window.location.hash === '#gallery';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {gallery ? <VFGallery /> : <App />}
  </StrictMode>,
);
