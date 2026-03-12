module.exports = function (api) {
  api.cache(true);
  const isJest = process.env.JEST_WORKER_ID !== undefined;
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      // NativeWind and Reanimated plugins are skipped in Jest:
      //  - nativewind/babel returns a config object (not a plugin fn) and isn't needed for unit tests
      //  - react-native-reanimated/plugin requires native worklets which aren't available in Jest
      ...(isJest ? [] : ['nativewind/babel', 'react-native-reanimated/plugin']),
    ],
  };
};
