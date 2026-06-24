import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  id: string;
  name: string;
}

// No auth system exists yet. This stands in for it so every call site
// already reads the actor the way it would once real auth lands —
// swapping this for req.user is the only change needed later.
export const MOCK_USER: CurrentUserPayload = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Mock User',
};

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user ?? MOCK_USER;
  },
);