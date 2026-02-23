import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [JwtAuthGuard, UsersService],
})
export class UsersModule {}