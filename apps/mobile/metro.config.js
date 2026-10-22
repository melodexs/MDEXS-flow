/**
 * Metro configuration (added for standalone/preview bundling, Phase 6D).
 *
 * Single customization: TypeScript-style relative imports that end in
 * `.js` (e.g. `export * from "./health.js"` in
 * `packages/contracts/src/index.ts`, which the contracts package keeps for
 * its compiled Node test flow) are remapped to the sibling `.ts` source
 * when the `.js` file does not exist. Everything else uses Expo's default
 * resolution. The monorepo already relies on Expo's default watchFolders
 * behavior for workspace packages.
 */

const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config'). ExpoConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, request, platform) => {
  if (request.endsWith(".js")) {
    const tsCandidate = `${request.slice(0, -3)}.ts`;
    try {
      // Let the default resolver try the sibling .ts file first.
      return context.resolveRequest(context, tsCandidate, platform);
    } catch {
      // Fall through to normal resolution (real .js file, node_modules, ...).
    }
  }
  return context.resolveRequest(context, request, platform);
};

module.exports = config;
