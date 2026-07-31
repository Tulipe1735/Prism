import antfu from "@antfu/eslint-config";
import nextPlugin from "@next/eslint-plugin-next";

const nextConfig = antfu(
  {
    type: "app",
    stylistic: false,
    typescript: true,
    react: true,
    jsonc: false,
    markdown: false,
    toml: false,
    yaml: false,
    ignores: ["**/.next/**", "**/.turbo/**", "**/coverage/**"],
  },
  {
    name: "prism/next-plugin",
    plugins: {
      "@next/next": nextPlugin,
    },
  },
  {
    name: "prism/next",
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    name: "prism/typescript",
    files: ["**/*.{ts,tsx}"],
    rules: {
      "test/prefer-lowercase-title": "off",
      "ts/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
);

export default nextConfig;
