// Web: load from `/public/yosemite.jpg` via Netlify rather than baking
// the 1.6 MB binary into the JS bundle every visitor downloads. Cached
// by `[[headers]] for = "/assets/*"` in `netlify.toml` — bump path on
// content change to invalidate.
export const heroBackground = { uri: '/yosemite.jpg' };
