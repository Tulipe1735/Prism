import { FlatCompat } from "@eslint/eslintrc";
import eslint from "@eslint/js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  allConfig: eslint.configs.all,
  baseDirectory: currentDirectory,
  recommendedConfig: eslint.configs.recommended,
});

const nextConfig = [
  {
    ignores: ["**/.next/**", "**/.turbo/**", "**/coverage/**", "**/node_modules/**"],
  },
  eslint.configs.recommended,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
];

export default nextConfig;
