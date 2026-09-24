import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@atlas-rail/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
      '@atlas-rail/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
      '@atlas-rail/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
      '@atlas-rail/solana/testing': path.resolve(__dirname, 'packages/solana/src/testing/index.ts'),
      '@atlas-rail/solana': path.resolve(__dirname, 'packages/solana/src/index.ts'),
      '@atlas-rail/mandate/testing': path.resolve(__dirname, 'packages/mandate/src/testing.ts'),
      '@atlas-rail/mandate': path.resolve(__dirname, 'packages/mandate/src/index.ts'),
      '@atlas-rail/receipt/testing': path.resolve(__dirname, 'packages/receipt/src/testing.ts'),
      '@atlas-rail/receipt': path.resolve(__dirname, 'packages/receipt/src/index.ts'),
      '@atlas-rail/x402/testkit': path.resolve(__dirname, 'packages/x402-client/src/testkit/index.ts'),
      '@atlas-rail/x402': path.resolve(__dirname, 'packages/x402-client/src/index.ts'),
      '@atlas-rail/api-client': path.resolve(__dirname, 'packages/api-client/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
