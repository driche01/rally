/**
 * Custom HTML shell for the static-rendered web build.
 *
 * Expo Router uses this file's default export as the root of the
 * server-rendered HTML for every route. The two non-default
 * additions over Expo's stock template:
 *
 * 1. `<link rel="preload" as="font">` for our self-hosted Inter
 *    woff2 — kicks off the font download in parallel with the JS
 *    bundle instead of waiting until the CSSOM discovers the
 *    @font-face rule.
 * 2. `<ScrollViewStyleReset />` keeps the `<ScrollView>` web reset
 *    consistent with Expo's default shell.
 */
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>Rally</title>
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
