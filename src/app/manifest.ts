import type { MetadataRoute } from 'next';

/** Lets traders add Second Mark to their home screen, where it opens full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Second Mark',
    short_name: 'Second Mark',
    description: 'The other side of the trade. A trading journal that checks whether you followed your plan.',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#15171C',
    theme_color: '#15171C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
