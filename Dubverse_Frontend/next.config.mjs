import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    // Docker Desktop's volume layer on Windows corrupts the webpack filesystem
    // cache across sleep/shutdown — twice observed as ENOENT on .pack.gz
    // renames followed by 500s on every page until the volume is wiped.
    // Dev-only: no pack files, nothing to corrupt. Cold compiles are slower.
    if (dev) config.cache = false;
    return config;
  },
};

export default withNextIntl(nextConfig);
