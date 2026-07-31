import antfu from "@antfu/eslint-config";

const baseConfig = antfu(
  {
    type: "lib",
    stylistic: false,
    typescript: true,
    jsonc: false,
    markdown: false,
    toml: false,
    yaml: false,
    ignores: ["**/.next/**", "**/.turbo/**", "**/coverage/**", "**/dist/**"],
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

export default baseConfig;
