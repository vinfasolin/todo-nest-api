import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt.guard';

describe('JwtAuthGuard (unit)', () => {
  const jwtMock = {
    verifyAsync: jest.fn(),
  };

  const makeCtx = (authHeader?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: authHeader ? { authorization: authHeader } : {},
        }),
      }),
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('nega se não houver Authorization header', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    await expect(guard.canActivate(makeCtx(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('nega se não for Bearer', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    await expect(guard.canActivate(makeCtx('Basic abc'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('nega se Bearer sem token', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    await expect(guard.canActivate(makeCtx('Bearer'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('nega se jwt.verifyAsync falhar', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    jwtMock.verifyAsync.mockRejectedValueOnce(new Error('bad token'));

    await expect(guard.canActivate(makeCtx('Bearer tok'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('nega se payload não tiver sub/uid válidos', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    jwtMock.verifyAsync.mockResolvedValueOnce({ sub: '' });

    await expect(guard.canActivate(makeCtx('Bearer tok'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('aceita: popula req.user com uid/sub/email (uid vem de payload.uid)', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    jwtMock.verifyAsync.mockResolvedValueOnce({
      sub: 's1',
      uid: 'u1',
      email: 'a@a.com',
    });

    const req: any = { headers: { authorization: 'Bearer tok' } };
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    const ok = await guard.canActivate(ctx);

    expect(ok).toBe(true);
    expect(req.user).toEqual({ uid: 'u1', sub: 's1', email: 'a@a.com' });

    expect(jwtMock.verifyAsync).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ secret: expect.any(String) }),
    );
  });

  it('aceita: quando payload.uid não existe, uid cai para sub', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    jwtMock.verifyAsync.mockResolvedValueOnce({
      sub: 's1',
      email: 'a@a.com',
    });

    const req: any = { headers: { authorization: 'Bearer tok' } };
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    const ok = await guard.canActivate(ctx);

    expect(ok).toBe(true);
    expect(req.user).toEqual({ uid: 's1', sub: 's1', email: 'a@a.com' });
  });

  it('email é opcional: não define email quando payload.email não existe', async () => {
    const guard = new JwtAuthGuard(jwtMock as any);

    jwtMock.verifyAsync.mockResolvedValueOnce({
      sub: 's1',
      uid: 'u1',
    });

    const req: any = { headers: { authorization: 'Bearer tok' } };
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => req }),
    };

    const ok = await guard.canActivate(ctx);

    expect(ok).toBe(true);
    expect(req.user).toEqual({ uid: 'u1', sub: 's1', email: undefined });
  });
});