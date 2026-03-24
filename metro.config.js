const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const mainRepo = path.resolve(__dirname, '../../..');

const config = getDefaultConfig(__dirname);

// Also watch the main repo so packages installed there can be resolved
config.watchFolders = [...(config.watchFolders ?? []), mainRepo];
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.join(mainRepo, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });
