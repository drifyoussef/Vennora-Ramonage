import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Lint du back : TypeScript, environnement Node. */
export default defineConfig([
  globalIgnores(["node_modules/**", "dist/**", ".storage/**"]),
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
  { languageOptions: { globals: globals.node } },
]);
