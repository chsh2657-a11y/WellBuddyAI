import type { NextConfig } from 'next';

// /api/* 요청을 NestJS API 로 넘겨 같은 출처(same-origin)에서 쿠키 인증을 쓴다.
// 주의: rewrites 는 빌드 시점에 확정되므로 API_URL 은 next build 할 때 지정한다.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
