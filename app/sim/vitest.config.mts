import { defineConfig } from 'vitest/config';

/**
 * The simulation runs (`sim/README.md`). Kept out of `npm test`: they call the real model, take
 * minutes, and read a copy of the app's own database.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['sim/**/*.sim.ts'],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    fileParallelism: false,
  },
});
