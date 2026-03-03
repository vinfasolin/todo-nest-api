// src/app.module.ts
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AppController } from "./app.controller";

import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { TodosModule } from "./todos/todos.module";

import { RateLimitModule } from "./common/throttle/rate-limit.module";
import { ThrottlerSkipGuard } from "./common/throttle/throttler-skip.guard";

@Module({
  imports: [
    // ✅ Throttler global (RateLimitModule é @Global e exporta os providers necessários)
    RateLimitModule,

    PrismaModule,
    AuthModule,
    UsersModule,
    TodosModule,
  ],
  controllers: [AppController],
  providers: [
    // ✅ Guard global que respeita @SkipThrottle()
    { provide: APP_GUARD, useClass: ThrottlerSkipGuard },
  ],
})
export class AppModule {}