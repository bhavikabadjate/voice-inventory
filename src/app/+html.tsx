// The HTML page around the web app. GitHub Pages can't send the
// cross-origin isolation headers the browser database needs, so a small
// service worker (coi-serviceworker) adds them; where the host already
// sends them (EAS Hosting) it does nothing.

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <script src="coi-serviceworker.js" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
