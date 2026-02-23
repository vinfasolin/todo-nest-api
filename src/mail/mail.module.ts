import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

// src/mail/mail.module.ts
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}