import { Module } from '@nestjs/common';
import { AppController } from './app.controller';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TodosModule } from './todos/todos.module';
//src/app.module.ts
@Module({
  imports: [PrismaModule, AuthModule, UsersModule, TodosModule],
  controllers: [AppController],
})
export class AppModule {}
