import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

// ✅ mock do bcrypt (porque no service é "import * as bcrypt from 'bcrypt'")
jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import * as bcrypt from "bcrypt";

describe("UsersService (unit)", () => {
  let service: UsersService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    todo: {
      deleteMany: jest.fn(),
    },
    passwordReset: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const jwtMock = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    // ✅ IMPORTANTE:
    // clearAllMocks limpa chamadas, mas pode manter implementações antigas.
    // Aqui resetamos explicitamente tudo pra evitar "vazamento" entre testes.
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.user.delete.mockReset();
    prismaMock.todo.deleteMany.mockReset();
    prismaMock.passwordReset.deleteMany.mockReset();
    prismaMock.$transaction.mockReset();

    jwtMock.signAsync.mockReset();

    (bcrypt.compare as jest.Mock).mockReset();
    (bcrypt.hash as jest.Mock).mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
      ],
    }).compile();

    service = moduleRef.get(UsersService);

    // defaults úteis
    jwtMock.signAsync.mockResolvedValue("JWT");
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("HASH");

    prismaMock.$transaction.mockResolvedValue([{}, {}, {}]);
  });

  describe("getMe()", () => {
    it("retorna user quando existe", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        email: "a@a.com",
        name: "A",
        picture: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.getMe("u1");
      expect(res.id).toBe("u1");
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: expect.any(Object),
      });
    });

    it("lança 404 se não existe", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.getMe("u1")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("updateProfile()", () => {
    it("falha se não vier nenhum campo", async () => {
      await expect(service.updateProfile("u1", {} as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("valida name length", async () => {
      const long = "a".repeat(121);
      await expect(
        service.updateProfile("u1", { name: long } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("valida picture length", async () => {
      const long = "a".repeat(2001);
      await expect(
        service.updateProfile("u1", { picture: long } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('falha se picture não for URL http(s)', async () => {
      await expect(
        service.updateProfile("u1", { picture: "ftp://x" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('normaliza "null"/"" para null e faz update', async () => {
      prismaMock.user.update.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        email: "a@a.com",
        name: null,
        picture: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.updateProfile("u1", { name: "null" } as any);

      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      const arg = prismaMock.user.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: "u1" });
      expect(arg.data).toEqual({ name: null });
      expect(res.id).toBe("u1");
    });

    it("atualiza name e picture quando fornecidos", async () => {
      prismaMock.user.update.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        email: "a@a.com",
        name: "Novo",
        picture: "http://x",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.updateProfile(
        "u1",
        { name: "  Novo ", picture: " http://x " } as any,
      );

      const arg = prismaMock.user.update.mock.calls[0][0];
      expect(arg.data).toEqual({ name: "Novo", picture: "http://x" });
    });
  });

  describe("changeEmail()", () => {
    it("exige newEmail", async () => {
      await expect(
        service.changeEmail("u1", { password: "x" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("exige password", async () => {
      await expect(
        service.changeEmail("u1", { newEmail: "a@a.com" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("404 se usuário não existe", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.changeEmail("u1", { newEmail: "a@a.com", password: "123" } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("bloqueia conta Google", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: "google-sub",
        passwordHash: null,
        email: "a@a.com",
      });

      await expect(
        service.changeEmail("u1", { newEmail: "a@a.com", password: "123" } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("bloqueia se não tem passwordHash local", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        passwordHash: null,
        email: "a@a.com",
      });

      await expect(
        service.changeEmail("u1", { newEmail: "a@a.com", password: "123" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("falha credenciais se bcrypt.compare false", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        passwordHash: "HASH",
        email: "a@a.com",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.changeEmail("u1", { newEmail: "a@a.com", password: "bad" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("409 se email já existe em outro usuário", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        passwordHash: "HASH",
        email: "old@old.com",
      });
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u2" });

      await expect(
        service.changeEmail("u1", { newEmail: "A@A.COM", password: "123" } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("atualiza email, devolve token novo, e normaliza email para lower", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        passwordHash: "HASH",
        email: "old@old.com",
      });
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      prismaMock.user.update.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        email: "novo@email.com",
        name: "A",
        picture: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      jwtMock.signAsync.mockResolvedValueOnce("NEW_JWT");

      const res = await service.changeEmail("u1", {
        newEmail: "  NOVO@EMAIL.COM ",
        password: "123",
      } as any);

      const updateArg = prismaMock.user.update.mock.calls[0][0];
      expect(updateArg.data.email).toBe("novo@email.com");

      expect(jwtMock.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ uid: "u1", email: "novo@email.com" }),
        expect.objectContaining({ expiresIn: "7d" }),
      );

      expect(res.token).toBe("NEW_JWT");
      expect(res.user.email).toBe("novo@email.com");
    });
  });

  describe("changePassword()", () => {
    it("exige currentPassword", async () => {
      await expect(
        service.changePassword("u1", { newPassword: "123456" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("exige newPassword >= 6", async () => {
      await expect(
        service.changePassword(
          "u1",
          { currentPassword: "old", newPassword: "123" } as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("404 se usuário não existe", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.changePassword(
          "u1",
          { currentPassword: "old", newPassword: "123456" } as any,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("bloqueia conta Google", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: "google-sub",
        passwordHash: null,
      });

      await expect(
        service.changePassword(
          "u1",
          { currentPassword: "old", newPassword: "123456" } as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("bloqueia se não tem passwordHash local", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: null,
      });

      await expect(
        service.changePassword(
          "u1",
          { currentPassword: "old", newPassword: "123456" } as any,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("falha credenciais se bcrypt.compare false", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: "HASH",
      });

      // 1ª compare (senha atual) => false
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.changePassword(
          "u1",
          { currentPassword: "bad", newPassword: "123456" } as any,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("falha se newPassword for igual à atual", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: "HASH",
      });

      // 1ª compare (currentPassword) => true
      // 2ª compare (newPassword vs hash atual) => true (mesma senha)
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await expect(
        service.changePassword(
          "u1",
          { currentPassword: "old", newPassword: "old" } as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("hasha nova senha e atualiza passwordHash", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: "HASH",
      });

      prismaMock.user.update.mockResolvedValueOnce({ id: "u1" });

      // ✅ agora o service chama compare 2x:
      // 1) valida currentPassword vs hash atual => true
      // 2) verifica se newPassword é igual à atual => false
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      (bcrypt.hash as jest.Mock).mockResolvedValueOnce("NEW_HASH");

      const res = await service.changePassword("u1", {
        currentPassword: "old",
        newPassword: "123456",
      } as any);

      expect(bcrypt.hash).toHaveBeenCalledWith("123456", 10);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { passwordHash: "NEW_HASH" },
      });
      expect(res).toEqual({ ok: true });
    });
  });

  describe("deleteMe()", () => {
    it("404 se usuário não existe", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.deleteMe("u1", {} as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("local exige password", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: "HASH",
      });

      await expect(service.deleteMe("u1", {} as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("local falha se não tem passwordHash", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: null,
      });

      await expect(
        service.deleteMe("u1", { password: "x" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("local falha se senha inválida", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: "HASH",
      });

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.deleteMe("u1", { password: "bad" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("google NÃO exige password e deleta em transação", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: "google-sub",
        passwordHash: null,
      });

      const res = await service.deleteMe("u1", {} as any);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const ops = prismaMock.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(3);

      expect(res).toEqual({ ok: true });
    });

    it("local com senha válida deleta em transação", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        googleSub: null,
        passwordHash: "HASH",
      });

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const res = await service.deleteMe("u1", { password: "ok" } as any);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ ok: true });
    });
  });
});