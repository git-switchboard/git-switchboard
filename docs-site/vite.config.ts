import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import vike from 'vike/plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_URL || '/',
  plugins: [vike(), react(), tailwindcss()],
  build: {
    rollupOptions: {
      external: ['/pagefind/pagefind.js'],
    },
  },
  ssr: {
    external: ['gray-matter', 'shiki'],
  },
});
