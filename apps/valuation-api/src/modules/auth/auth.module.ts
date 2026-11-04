import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { LoginThrottle } from './login-throttle.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginThrottle],
})
export class AuthModule {}
