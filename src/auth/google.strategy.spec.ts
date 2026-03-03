import { UnauthorizedException } from '@nestjs/common';

// ✅ mock do google-auth-library antes de importar a classe
const verifyIdTokenMock = jest.fn();

jest.mock('google-auth-library', () => {
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: verifyIdTokenMock,
    })),
  };
});

import { GoogleIdTokenVerifier } from './google.strategy';

describe('GoogleIdTokenVerifier (unit)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('nega se idToken vazio', async () => {
    const v = new GoogleIdTokenVerifier();
    await expect(v.verify('')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sucesso: retorna payload normalizado', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-from-env';

    verifyIdTokenMock.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'sub1',
        email: 'a@a.com',
        name: 'User',
        picture: 'http://pic',
        email_verified: true,
      }),
    });

    const v = new GoogleIdTokenVerifier();
    const res = await v.verify('token');

    expect(res).toEqual({
      sub: 'sub1',
      email: 'a@a.com',
      name: 'User',
      picture: 'http://pic',
      email_verified: true,
    });

    // chamou verifyIdToken com audience array (env + fallback)
    expect(verifyIdTokenMock).toHaveBeenCalledTimes(1);
    const arg = verifyIdTokenMock.mock.calls[0][0];
    expect(arg.idToken).toBe('token');
    expect(Array.isArray(arg.audience)).toBe(true);
    expect(arg.audience).toContain('client-from-env');
    expect(arg.audience.length).toBeGreaterThanOrEqual(1);
  });

  it('payload inválido (sem sub/email) -> Unauthorized', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      getPayload: () => ({ sub: '', email: '' }),
    });

    const v = new GoogleIdTokenVerifier();
    await expect(v.verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('quando verifyIdToken lança erro -> Unauthorized', async () => {
    verifyIdTokenMock.mockRejectedValueOnce(new Error('bad token'));

    const v = new GoogleIdTokenVerifier();
    await expect(v.verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('audiences não duplica quando env == fallback', async () => {
    // fallback está hardcoded na classe
    process.env.GOOGLE_CLIENT_ID =
      '764728744073-4h8l7638uom853plt0hdsicn9avugf3p.apps.googleusercontent.com';

    verifyIdTokenMock.mockResolvedValueOnce({
      getPayload: () => ({ sub: 's', email: 'e@e.com' }),
    });

    const v = new GoogleIdTokenVerifier();
    await v.verify('token');

    const arg = verifyIdTokenMock.mock.calls[0][0];
    // se duplicasse, teria 2 iguais; aqui esperamos 1 item (o mesmo)
    const uniq = Array.from(new Set(arg.audience));
    expect(uniq.length).toBe(arg.audience.length);
  });
});