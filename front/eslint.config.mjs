import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Lint du front : TypeScript, environnement navigateur, règles des hooks
 * React. Elles attrapent ce que le compilateur laisse passer — un hook
 * appelé après un retour anticipé plante l'écran quand les données arrivent.
 */
export default defineConfig([
  globalIgnores(["node_modules/**", "dist/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Préfixe « _ » : paramètre volontairement ignoré.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
