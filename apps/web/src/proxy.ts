import { type NextRequest, NextResponse } from 'next/server';

/**
 * 로그인 쿠키가 없으면 앱 화면 대신 로그인 페이지로 보낸다.
 * (쿠키 존재만 확인한다. 실제 인증·권한 검사는 API 가 한다.)
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('wb_rt') || request.cookies.has('wb_at');
  if (!hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*', '/onboarding/:path*'],
};
