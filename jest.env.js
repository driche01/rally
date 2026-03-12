/**
 * Custom Jest test environment for Expo SDK 55 / Jest 30 compatibility.
 *
 * The problem:
 *   expo/src/Expo.fx.tsx imports './winter', which loads runtime.native.ts.
 *   runtime.native.ts calls installGlobal() to replace native globals like
 *   `structuredClone` and `__ExpoImportMetaRegistry` with lazy getters that
 *   do dynamic require() calls.  In Jest 30, those lazy-getter-triggered
 *   require() calls fail with "outside of scope of the test code" because
 *   `isInsideTestCode === false` at setup time.
 *
 * The fix:
 *   Before ANY module loads, lock the globals that installGlobal() would
 *   replace by making them non-configurable.  installGlobal() checks
 *   `configurable` and bails out if false, so the lazy getter is never
 *   installed and the "outside of scope" crash never happens.
 *
 *   We also suppress the expected "Failed to set polyfill" console.error
 *   messages that Expo's winter runtime emits as a result.
 */
'use strict';

const { TestEnvironment } = require('jest-environment-node');

// All globals that expo/src/winter/runtime.native.ts tries to install
// with lazy require() getters.
const EXPO_WINTER_GLOBALS = [
  'structuredClone',
  '__ExpoImportMetaRegistry',
  'TextDecoder',
  'TextDecoderStream',
  'TextEncoderStream',
  'URL',
  'URLSearchParams',
];

class ExpoCompatTestEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);

    // Lock every global that Expo's winter runtime would overwrite with a
    // lazy getter.  We do this in the environment constructor, which runs
    // before setupFiles, ensuring installGlobal() sees non-configurable
    // descriptors and skips installing the broken lazy getters.
    for (const name of EXPO_WINTER_GLOBALS) {
      const current = this.global[name];
      if (current !== undefined) {
        try {
          Object.defineProperty(this.global, name, {
            value: current,
            writable: true,
            configurable: false, // <── prevents installGlobal() from replacing it
            enumerable: true,
          });
        } catch (_) {
          // Already non-configurable — nothing to do.
        }
      }
    }

    // Ensure __ExpoImportMetaRegistry exists even if not already on the global
    if (this.global.__ExpoImportMetaRegistry === undefined) {
      Object.defineProperty(this.global, '__ExpoImportMetaRegistry', {
        value: { importMetaRequire: (id) => require(id) },
        writable: true,
        configurable: false,
        enumerable: true,
      });
    }

    // Suppress the "Failed to set polyfill" console.error messages that
    // expo/src/winter/installGlobal.ts emits when it can't override our
    // locked globals.  These are benign — the native Node globals remain.
    const origError = this.global.console.error.bind(this.global.console);
    this.global.console.error = (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('Failed to set polyfill')) {
        return;
      }
      origError(...args);
    };
  }
}

module.exports = ExpoCompatTestEnvironment;
