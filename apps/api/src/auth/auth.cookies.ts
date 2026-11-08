import type { Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './token.service.js';

export const ACCESS_COOKIE = 'wb_at';
export const REFRESH_COOKIE = 'wb_rt';
/** 브라우저에서 보이는 경로 기준(웹은 /api/* 를 API 로 넘긴다). */
const REFRESH_COOKIE_PATH = '/api/auth';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/** 모바일 앱은 쿠키 대신 응답 본문으로 토큰을 받는다(x-auth-mode: token). */
export function wantsTokenMode(req: Request): boolean {
  return req.get('x-auth-mode') === 'token';
}

export function setAuthCookies(res: Response, tokens: Partial<IssuedTokens>, config: AppConfig) {
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: config.env === 'production' };
  if (tokens.accessToken) {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...base,
      path: '/',
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
  }
  if (tokens.refreshToken) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...base,
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

export function readAccessToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  return cookie || null;
}

export function readRefreshToken(req: Request, bodyToken?: string): string | null {
  return bodyToken || (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE] || null;
}
