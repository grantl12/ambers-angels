import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['157.245.125.103'],
  transpilePackages: ['react-map-gl', 'mapbox-gl'],
};

export default nextConfig;
