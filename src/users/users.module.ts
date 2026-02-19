import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthModule } from '../auth/auth.module';

//src/users/users.module.ts
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [JwtAuthGuard],
})
export class UsersModule {}
