import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { GoogleIdTokenVerifier } from './google.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [GoogleIdTokenVerifier, PasswordResetService],
  exports: [JwtModule, GoogleIdTokenVerifier],
})
export class AuthModule {}