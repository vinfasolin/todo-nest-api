import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PasswordResetService } from './password-reset.service';

// ✅ mock do bcrypt (service usa "import * as bcrypt from 'bcrypt'")
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));
import * as bcrypt from 'bcrypt';

describe('PasswordResetService (unit)', () => {
  let service: PasswordResetService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passwordReset: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mailMock = {
    send: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MailService, useValue: mailMock },
      ],
    }).compile();

    service = moduleRef.get(PasswordResetService);

    (bcrypt.hash as jest.Mock).mockResolvedValue('HASH');
    prismaMock.$transaction.mockResolvedValue([{}, {}]);
  });

  describe('requestReset()', () => {
    it('exige email', async () => {
      await expect(service.requestReset('')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('sempre retorna ok quando usuário não existe (anti-enumeração)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const res = await service.requestReset('naoexiste@x.com');

      expect(res).toEqual({ ok: true });
      expect(prismaMock.passwordReset.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.passwordReset.create).not.toHaveBeenCalled();
      expect(mailMock.send).not.toHaveBeenCalled();
    });

    it('conta Google retorna ok e NÃO envia e-mail', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        email: 'a@a.com',
        googleSub: 'google-sub',
        passwordHash: null,
        name: 'A',
      });

      const res = await service.requestReset('A@A.COM');

      expect(res).toEqual({ ok: true });
      expect(prismaMock.passwordReset.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.passwordReset.create).not.toHaveBeenCalled();
      expect(mailMock.send).not.toHaveBeenCalled();
    });

    it('conta local: limpa resets antigos, cria reset e envia e-mail', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        email: 'user@x.com',
        googleSub: null,
        passwordHash: 'HASH_OLD',
        name: 'User',
      });

      prismaMock.passwordReset.deleteMany.mockResolvedValueOnce({ count: 2 });
      prismaMock.passwordReset.create.mockResolvedValueOnce({ id: 'pr1' });

      const res = await service.requestReset(' USER@X.COM ');

      expect(res).toEqual({ ok: true });

      expect(prismaMock.passwordReset.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });

      // create: garante que salva userId + codeHash + expiresAt
      expect(prismaMock.passwordReset.create).toHaveBeenCalledTimes(1);
      const createArg = prismaMock.passwordReset.create.mock.calls[0][0];
      expect(createArg.data.userId).toBe('u1');
      expect(typeof createArg.data.codeHash).toBe('string');
      expect(createArg.data.codeHash.length).toBeGreaterThan(10);
      expect(createArg.data.expiresAt).toBeInstanceOf(Date);

      // envia e-mail
      expect(mailMock.send).toHaveBeenCalledTimes(1);
      const mailArg = mailMock.send.mock.calls[0][0];
      expect(mailArg.to).toBe('user@x.com');
      expect(mailArg.subject).toContain('ToDo Premium');
      expect(mailArg.text).toContain('Seu código é:');
      expect(mailArg.fromName).toBe('ToDo Premium');
    });
  });

  describe('confirmReset()', () => {
    it('exige email', async () => {
      await expect(
        service.confirmReset('', '123456', '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('exige code', async () => {
      await expect(
        service.confirmReset('a@a.com', '', '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('exige newPassword >= 6', async () => {
      await expect(
        service.confirmReset('a@a.com', '123456', '123'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('se user não existe -> BadRequest genérico (Invalid code)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.confirmReset('a@a.com', '123456', '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('bloqueia conta Google (Forbidden)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        googleSub: 'google-sub',
      });

      await expect(
        service.confirmReset('a@a.com', '123456', '123456'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('Invalid code quando não acha passwordReset válido', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        googleSub: null,
      });
      prismaMock.passwordReset.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.confirmReset('a@a.com', '111111', '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('Code expired quando expiresAt < agora', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        googleSub: null,
      });
      prismaMock.passwordReset.findFirst.mockResolvedValueOnce({
        id: 'pr1',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.confirmReset('a@a.com', '111111', '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sucesso: hasha senha e faz $transaction (user.update + passwordReset.update)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        googleSub: null,
      });

      prismaMock.passwordReset.findFirst.mockResolvedValueOnce({
        id: 'pr1',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      });

      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('NEW_HASH');
      prismaMock.$transaction.mockResolvedValueOnce([{}, {}]);

      const res = await service.confirmReset('A@A.COM', '123456', '123456');

      expect(bcrypt.hash).toHaveBeenCalledWith('123456', 10);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const ops = prismaMock.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(2);

      expect(res).toEqual({ ok: true });
    });
  });
});