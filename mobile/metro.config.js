// Metro's defaults, plus the one thing whisper.rn needs.
//
// whisper.rn imports `safe-buffer`, which does `require('buffer')` - a Node
// standard library module. The React Native runtime has no Node standard
// library, so that import fails to resolve and the whole bundle dies with
// UnableToResolveError before the app ever loads.
//
// The npm `buffer` package is the same API implemented in plain JavaScript, so
// pointing the bare specifier at it makes the import resolve and behave. The
// trailing slash is load-bearing: `require.resolve('buffer')` would find Node's
// own core module here in the config, which is not what should be bundled.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer/'),
};

module.exports = config;
