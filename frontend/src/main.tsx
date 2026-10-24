import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './app/router';
import { queryClient } from './client/controllers';
import { DiffProvider } from './components/diff-provider';
import './style.css';

const element = document.getElementById('root');
if (!element) {
  throw new Error('Missing root element');
}
createRoot(element).render(
  <StrictMode>
    <DiffProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </DiffProvider>
  </StrictMode>,
);
