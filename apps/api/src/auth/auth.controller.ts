import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type LoginInput,
  LoginSchema,
  SessionSchema,
  type SignupInput,
  SignupSchema,
  SwitchCompanySchema,
} from '@wellbuddy/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireContext } from '../common/request-context.js';
import { ZodBody, ZodResponse } from '../common/zod.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import {
  clearAuthCookies,
  readRefreshToken,
  setAuthCookies,
  wantsTokenMode,
} from './auth.cookies.js';
import { AuthResultSchema, OkSchema, RefreshBodySchema } from './auth.schemas.js';
import { type AuthResult, AuthService, type ClientMeta } from './auth.service.js';
import { AllowNoCompany, Public } from './decorators.js';
import { SessionService } from './session.service.js';

const AUTH_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

function meta(req: Request): ClientMeta {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('signup')
  @ZodResponse(AuthResultSchema, { status: 201, description: '가입 후 바로 로그인된다' })
  async signup(
    @ZodBody(SignupSchema) body: SignupInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(req, res, await this.auth.signup(body, meta(req)));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ZodResponse(AuthResultSchema)
  async login(
    @ZodBody(LoginSchema) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(req, res, await this.auth.login(body, meta(req)));
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ZodResponse(AuthResultSchema.or(OkSchema))
  async refresh(
    @ZodBody(RefreshBodySchema) body: z.infer<typeof RefreshBodySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readRefreshToken(req, body.refreshToken);
    if (!token) throw new UnauthorizedException();
    const result = await this.auth.refresh(token, meta(req));
    if (!result) {
      // 다른 탭이 방금 갱신함: 브라우저에는 이미 새 쿠키가 있으므로 그대로 성공 처리
      if (wantsTokenMode(req)) throw new UnauthorizedException();
      return { ok: true as const };
    }
    return this.respond(req, res, result);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @ZodBody(RefreshBodySchema) body: z.infer<typeof RefreshBodySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshToken(req, body.refreshToken));
    clearAuthCookies(res);
  }

  @AllowNoCompany()
  @Get('me')
  @ZodResponse(SessionSchema, { description: '현재 사용자·회사·권한' })
  me() {
    const ctx = requireContext();
    return this.sessions.getSession(ctx.userId, ctx.companyId);
  }

  @AllowNoCompany()
  @Post('switch-company')
  @HttpCode(200)
  @ZodResponse(SessionSchema)
  async switchCompany(
    @ZodBody(SwitchCompanySchema) body: z.infer<typeof SwitchCompanySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = requireContext();
    const accessToken = await this.auth.switchCompany(ctx.userId, body.companyId);
    if (wantsTokenMode(req)) res.setHeader('x-access-token', accessToken);
    else setAuthCookies(res, { accessToken }, this.config);
    return this.sessions.getSession(ctx.userId, body.companyId);
  }

  private respond(req: Request, res: Response, result: AuthResult) {
    if (wantsTokenMode(req)) return result;
    setAuthCookies(res, result, this.config);
    return { user: result.user, companyId: result.companyId };
  }
}
