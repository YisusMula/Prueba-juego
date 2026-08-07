import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Rutas relativas para que el build funcione en GitHub Pages bajo un subdirectorio.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
