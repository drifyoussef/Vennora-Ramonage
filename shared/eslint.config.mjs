import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

/** Lint du code commun : TypeScript, sans environnement particulier. */
export default defineConfig([
  globalIgnores(["node_modules/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Dossier de référence explicite : sans lui, l'extension ESLint de VS Code,
  // lancée depuis la racine du dépôt, hésite entre plusieurs tsconfig.
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  {
    rules: {
      // Préfixe « _ » : paramètre volontairement ignoré.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
]);
