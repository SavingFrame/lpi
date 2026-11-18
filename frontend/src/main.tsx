import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './app/router';
import { DiffProvider } from './components/diff-provider';
import './style.css';

const element = document.getElementById('root');
if (!element) {
  throw new Error('Missing root element');
}
createRoot(element).render(
  <StrictMode>
    <DiffProvider>
      <RouterProvider router={router} />
    </DiffProvider>
  </StrictMode>,
);
