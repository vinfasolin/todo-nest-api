// src/common/throttle/skip-throttle.decorator.ts
import { SetMetadata } from "@nestjs/common";

/**
 * Marca uma rota/controller para ignorar throttling.
 * Use junto com um guard que leia esse metadata (ThrottlerSkipGuard).
 */
export const SKIP_THROTTLE_KEY = "skip_throttle";

export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);