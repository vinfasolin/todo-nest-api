// src/common/throttle/throttler-skip.guard.ts
import { Injectable } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

import { SKIP_THROTTLE_KEY } from "./skip-throttle.decorator";

@Injectable()
export class ThrottlerSkipGuard extends ThrottlerGuard {
  /**
   * ✅ Sem constructor:
   * o Nest usa o constructor do ThrottlerGuard e injeta corretamente
   * conforme a SUA versão do @nestjs/throttler.
   */

  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    const handler = context.getHandler?.();
    const cls = context.getClass?.();

    // ✅ Fallback seguro (evita instanceof Reflector, que pode falhar em testes)
    const reflector = (this as any).reflector as
      | { get: <T>(metadataKey: any, target: any) => T | undefined }
      | undefined;

    if (reflector?.get) {
      const skipOnHandler = handler
        ? reflector.get<boolean>(SKIP_THROTTLE_KEY, handler)
        : undefined;

      const skipOnClass = cls
        ? reflector.get<boolean>(SKIP_THROTTLE_KEY, cls)
        : undefined;

      if ((skipOnHandler ?? skipOnClass) === true) return true;
    }

    return super.shouldSkip(context);
  }
}