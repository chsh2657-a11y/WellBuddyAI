import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MembershipService } from './membership.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, MembershipService, SessionService, TokenService],
  exports: [AuthService, MembershipService, SessionService, TokenService],
})
export class AuthModule {}
