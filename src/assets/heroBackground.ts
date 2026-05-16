// Native: ship the JPEG in the app bundle (no network on cold start).
// Web: see `heroBackground.web.ts` — served from `public/yosemite.jpg`
// at runtime so the 1.6 MB binary never touches the JS bundle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const heroBackground = require('../../assets/yosemite.jpg');
