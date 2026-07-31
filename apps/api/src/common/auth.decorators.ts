import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as { userId: string; role: string };
  },
);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: Error | null, user: T): T {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}

function isProdLikeAdminConfig(): boolean {
  return (
    process.env.NODE_ENV === 'production'
    || process.env.NOVAE_ENV === 'production'
    || process.env.REQUIRE_ADMIN_API_KEY === 'true'
  );
}

/** Resolves the admin API key. Fail-closed in production-like configs when unset. */
export function resolveAdminApiKey(): string | null {
  const configured = process.env.ADMIN_API_KEY?.trim();
  if (configured) return configured;
  if (isProdLikeAdminConfig()) return null;
  return 'dev-admin-key';
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-admin-key'];
    const expected = resolveAdminApiKey();
    if (!expected) {
      throw new UnauthorizedException('Admin access misconfigured');
    }
    // Always require x-admin-key — no JWT/role bypass.
    if (typeof key === 'string' && key.length > 0 && key === expected) {
      return true;
    }
    throw new UnauthorizedException('Admin access required');
  }
}
