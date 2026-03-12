// Silence known noisy warnings and errors during tests

jest.spyOn(console, 'warn').mockImplementation((msg) => {
  if (
    typeof msg === 'string' &&
    (msg.includes('NativeWind') || msg.includes('Reanimated'))
  ) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(msg);
});

// Expo's winter runtime (runtime.native.ts) tries to install lazy-getter
// polyfills for globals that we intentionally locked as non-configurable in
// jest.env.js.  Suppress the expected "Failed to set polyfill" console.error
// messages so test output stays clean.
jest.spyOn(console, 'error').mockImplementation((msg) => {
  if (typeof msg === 'string' && msg.startsWith('Failed to set polyfill')) {
    return;
  }
  // eslint-disable-next-line no-console
  console.error(msg);
});
