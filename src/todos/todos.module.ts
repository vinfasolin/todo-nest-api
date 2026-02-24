// src/todos/todos.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

@Module({
  imports: [
    // ✅ traz JwtModule/JwtService via AuthModule exports
    AuthModule,
  ],
  controllers: [TodosController],
  providers: [
    TodosService,
    // ✅ JwtAuthGuard precisa de JwtService (vem do AuthModule)
    JwtAuthGuard,
  ],
})
export class TodosModule {}