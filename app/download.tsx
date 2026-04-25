/**
 * `/download` is preserved as a redirect to `/` so existing SMS install
 * CTAs (sent before the landing+download collapse) still resolve.
 *
 * The conversion experience now lives at `/`: the landing page itself
 * captures emails inline. There is no separate beta-signup page anymore.
 *
 * A Netlify 301 redirect in `netlify.toml` handles the redirect at the
 * server layer (better for SEO + faster). This file is a client-side
 * fallback in case the SPA loads `/download` directly without hitting
 * Netlify's redirect rules (e.g. on a hard refresh during dev).
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function DownloadRedirect() {
  // Forward query params (source, trip) so attribution survives the redirect.
  const params = useLocalSearchParams<{ source?: string; trip?: string }>();
  const search = new URLSearchParams();
  if (params.source) search.set('source', String(params.source));
  if (params.trip) search.set('trip', String(params.trip));
  const qs = search.toString();
  const href = qs ? `/?${qs}` : '/';
  return <Redirect href={href as Parameters<typeof Redirect>[0]['href']} />;
}
