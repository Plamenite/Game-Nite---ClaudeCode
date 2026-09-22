// Metro is the bundler that packs our TypeScript into the phone app.
//
// Our shared package (packages/game-rules) is an ES module, so its files
// import each other with a ".js" suffix even though the sources are ".ts".
// TypeScript and Node understand that convention; Metro does not. This
// config teaches Metro: if "./x.js" cannot be found, try "./x.ts" / ".tsx".
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const upstreamResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = (name) =>
    upstreamResolve
      ? upstreamResolve(context, name, platform)
      : context.resolveRequest(context, name, platform);

  try {
    return resolve(moduleName);
  } catch (error) {
    const isRelative = moduleName.startsWith('./') || moduleName.startsWith('../');
    if (isRelative && moduleName.endsWith('.js')) {
      const base = moduleName.slice(0, -'.js'.length);
      for (const ext of ['.ts', '.tsx']) {
        try {
          return resolve(base + ext);
        } catch {
          // try the next extension
        }
      }
    }
    throw error;
  }
};

module.exports = config;
