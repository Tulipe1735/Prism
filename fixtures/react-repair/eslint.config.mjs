import antfu from "@antfu/eslint-config";

const config = antfu(
  {
    type: "app",
    stylistic: false,
    typescript: true,
    react: true,
    jsonc: false,
    markdown: false,
    toml: false,
    yaml: false,
    ignores: ["**/dist/**", "**/coverage/**"],
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

export default config;
