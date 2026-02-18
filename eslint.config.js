import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'ralphy/**',
      'docs/**',
      '**/*.test.ts',
      '**/__tests__/**',
      'eslint.config.js',
      'vitest.config.ts',
    ],
  },
  {
    files: ['src/ui/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-control-regex': 'off',
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  }
);
