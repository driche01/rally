const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// In Claude Code git worktrees, node_modules live in the main repo.
// Only apply this when running inside a .claude/worktrees/ path so Vercel
// and other CI environments are unaffected.
// Note: a node_modules symlink in the worktree root is also required so Metro
// can resolve the expo-router entry point (nodeModulesPaths alone is not enough
// for entry-point resolution). Create it once with:
//   ln -s <mainRepo>/node_modules <worktree>/node_modules
if (__dirname.includes('.claude/worktrees/')) {
  const mainRepo = path.resolve(__dirname, '../../..');
  config.watchFolders = [...(config.watchFolders ?? []), mainRepo];
  config.resolver.nodeModulesPaths = [
    ...(config.resolver.nodeModulesPaths ?? []),
    path.join(mainRepo, 'node_modules'),
  ];
}

module.exports = withNativeWind(config, { input: './global.css' });
