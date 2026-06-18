import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@prisma/client',
    'bull',
    'fluent-ffmpeg',
    'formidable',
    'google-auth-library',
    'googleapis',
    'ioredis',
    'multer',
    'twitter-api-v2',
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
