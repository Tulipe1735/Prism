import antfu from "@antfu/eslint-config";

export default antfu(
  {
    type: "lib",
    stylistic: false,
    typescript: true,
    jsonc: false,
    markdown: false,
    toml: false,
    yaml: false,
    ignores: [
      "coverage/**",
      ".release-worktree/**",
      "dist/**",
      "release/**",
      ".packaging/**",
      "src/browser/snapshot.js",
    ],
  },
  {
    name: "prism/typescript",
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
      "test/prefer-lowercase-title": "off",
      "ts/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // Prettier lowercases hex digits; this rule insists on uppercase. Prettier owns formatting.
      "unicorn/number-literal-case": "off",
    },
  },
);
