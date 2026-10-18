// Flat config for the mobile app, wrapping Expo's ESLint configuration.
// eslint-config-expo's default export is an eslintrc-style object; convert
// it for flat config via FlatCompat so the rules still apply.
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  { ignores: [".expo/**", "node_modules/**"] },
  ...compat.extends("expo"),
  {
    rules: {
      "import/no-default-export": "off", // Expo Router screens use default exports
    },
  },
];
