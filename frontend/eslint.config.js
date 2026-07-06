import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// 정확성 중심의 경량 설정 — 스타일보다 버그 방지(특히 hooks 규칙)에 집중
export default tseslint.config(
  { ignores: ['dist', 'dist-app', 'e2e-dist', 'e2e/audit', 'node_modules', 'public', '*.config.js', '*.config.ts', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // public의 서비스워커 스크립트(sw-notify.js)는 워커 전역(self 등)을 사용
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
)
