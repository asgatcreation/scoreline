import { defineConfig } from 'eslint/config';
import base from '../../eslint.config.base.mjs';

export default defineConfig([
  ...base,
  {
    // Nest injects constructor parameters by their runtime type, so those
    // imports must stay as values, not `import type`.
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
]);
