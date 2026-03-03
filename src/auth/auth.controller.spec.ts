// src/auth/auth.controller.spec.ts
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordResetService } from "./password-reset.service";
import { GoogleIdTokenVerifier } from "./google.strategy";
import { AuthController } from "./auth.controller";

// ✅ IMPORTANTE: o controller está com @UseGuards(ThrottlerSkipGuard)
import { ThrottlerSkipGuard } from "../common/throttle/throttler-skip.guard";

// ✅ mock bcrypt (controller usa "import * as bcrypt from 'bcrypt'")
jest.mock("bcrypt", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
import * as bcrypt from "bcrypt";

describe("AuthController (unit)", () => {
  let controller: AuthController;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const googleMock = {
    verify: jest.fn(),
  };

  const jwtMock = {
    signAsync: jest.fn(),
  };

  const resetMock = {
    requestReset: jest.fn(),
    confirmReset: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: GoogleIdTokenVerifier, useValue: googleMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: PasswordResetService, useValue: resetMock },
      ],
    })
      // ✅ ESSENCIAL: override do guard REALMENTE usado no @UseGuards(...)
      .overrideGuard(ThrottlerSkipGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AuthController);

    // defaults
    jwtMock.signAsync.mockResolvedValue("JWT");
    (bcrypt.hash as jest.Mock).mockResolvedValue("HASH");
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  describe("register()", () => {
    it("falha se email faltar", async () => {
      await expect(
        controller.register({ email: "", password: "123456", name: "A" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("falha se senha < 6", async () => {
      await expect(
        controller.register({ email: "a@a.com", password: "123", name: "A" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("falha se email já registrado (existing.passwordHash)", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        email: "a@a.com",
        passwordHash: "HASH",
      });

      await expect(
        controller.register({ email: "a@a.com", password: "123456" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });

    it("upsert + retorna token e user", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      prismaMock.user.upsert.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        email: "a@a.com",
        name: "A",
        picture: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      jwtMock.signAsync.mockResolvedValueOnce("JWT2");

      const res = await controller.register({
        email: " A@A.COM ",
        password: "123456",
        name: "  A  ",
      } as any);

      expect(bcrypt.hash).toHaveBeenCalledWith("123456", 10);

      const upsertArg = prismaMock.user.upsert.mock.calls[0][0];
      expect(upsertArg.where.email).toBe("a@a.com");
      expect(upsertArg.create.email).toBe("a@a.com");
      expect(upsertArg.create.name).toBe("A");

      expect(jwtMock.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ uid: "u1", email: "a@a.com" }),
        expect.any(Object),
      );

      expect(res.ok).toBe(true);
      expect(res.token).toBe("JWT2");
      expect(res.user.email).toBe("a@a.com");
    });

    it("se existing existe mas sem passwordHash (ex: conta Google), permite upsert setar senha", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        email: "a@a.com",
        passwordHash: null,
      });

      prismaMock.user.upsert.mockResolvedValueOnce({
        id: "u1",
        googleSub: "google-sub",
        email: "a@a.com",
        name: null,
        picture: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await controller.register({
        email: "a@a.com",
        password: "123456",
      } as any);

      expect(prismaMock.user.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("login()", () => {
    it("falha se missing email", async () => {
      await expect(
        controller.login({ email: "", password: "x" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("falha se missing password", async () => {
      await expect(
        controller.login({ email: "a@a.com", password: "" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("401 se user não existe", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        controller.login({ email: "a@a.com", password: "x" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("401 se conta não tem passwordHash", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        email: "a@a.com",
        passwordHash: null,
      });

      await expect(
        controller.login({ email: "a@a.com", password: "x" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("401 se senha inválida", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        email: "a@a.com",
        name: null,
        picture: null,
        passwordHash: "HASH",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        controller.login({ email: "a@a.com", password: "bad" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("sucesso: retorna token e user sem passwordHash", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        googleSub: null,
        email: "a@a.com",
        name: "A",
        picture: null,
        passwordHash: "HASH",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      jwtMock.signAsync.mockResolvedValueOnce("JWT3");
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const res = await controller.login({
        email: "A@A.COM",
        password: "ok",
      } as any);

      expect(res.ok).toBe(true);
      expect(res.token).toBe("JWT3");
      expect((res.user as any).passwordHash).toBeUndefined();
      expect(res.user.email).toBe("a@a.com");
    });
  });

  describe("googleLogin()", () => {
    it("401 se missing idToken", async () => {
      await expect(controller.googleLogin({ idToken: "" } as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("401 se payload inválido (sem sub/email)", async () => {
      googleMock.verify.mockResolvedValueOnce({ sub: "", email: "" });

      await expect(
        controller.googleLogin({ idToken: "tok" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("fluxo bySub: atualiza por googleSub e retorna token", async () => {
      googleMock.verify.mockResolvedValueOnce({
        sub: "sub1",
        email: "a@a.com",
        name: "A",
        picture: "p",
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u1" });

      prismaMock.user.update.mockResolvedValueOnce({
        id: "u1",
        googleSub: "sub1",
        email: "a@a.com",
        name: "A",
        picture: "p",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      jwtMock.signAsync.mockResolvedValueOnce("JWTG");

      const res = await controller.googleLogin({ idToken: "tok" } as any);

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { googleSub: "sub1" },
          data: expect.objectContaining({ email: "a@a.com" }),
        }),
      );

      expect(res.ok).toBe(true);
      expect(res.token).toBe("JWTG");
      expect(res.user.googleSub).toBe("sub1");
    });

    it("fluxo byEmail local: linka googleSub quando byEmail existe e não tem googleSub", async () => {
      googleMock.verify.mockResolvedValueOnce({
        sub: "sub1",
        email: "a@a.com",
        name: "A",
        picture: null,
      });

      prismaMock.user.findUnique.mockResolvedValueOnce(null); // bySub
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u1", googleSub: null }); // byEmail

      prismaMock.user.update.mockResolvedValueOnce({
        id: "u1",
        googleSub: "sub1",
        email: "a@a.com",
        name: "A",
        picture: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await controller.googleLogin({ idToken: "tok" } as any);

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: "a@a.com" },
          data: expect.objectContaining({ googleSub: "sub1" }),
        }),
      );
      expect(res.ok).toBe(true);
      expect(res.user.googleSub).toBe("sub1");
    });

    it("conflito: byEmail já tem googleSub => Unauthorized", async () => {
      googleMock.verify.mockResolvedValueOnce({
        sub: "sub1",
        email: "a@a.com",
      });

      prismaMock.user.findUnique.mockResolvedValueOnce(null); // bySub
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u2", googleSub: "sub2" }); // byEmail

      await expect(
        controller.googleLogin({ idToken: "tok" } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("novo user: cria quando não existe bySub nem byEmail", async () => {
      googleMock.verify.mockResolvedValueOnce({
        sub: "sub1",
        email: "a@a.com",
        name: "A",
        picture: "p",
      });

      prismaMock.user.findUnique.mockResolvedValueOnce(null); // bySub
      prismaMock.user.findUnique.mockResolvedValueOnce(null); // byEmail

      prismaMock.user.create.mockResolvedValueOnce({
        id: "u1",
        googleSub: "sub1",
        email: "a@a.com",
        name: "A",
        picture: "p",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await controller.googleLogin({ idToken: "tok" } as any);

      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ googleSub: "sub1", email: "a@a.com" }),
        }),
      );
      expect(res.ok).toBe(true);
      expect(res.user.id).toBe("u1");
    });
  });

  describe("forgotPassword()", () => {
    it("chama reset.requestReset e retorna ok", async () => {
      resetMock.requestReset.mockResolvedValueOnce({ ok: true });

      const res = await controller.forgotPassword({ email: "a@a.com" } as any);

      expect(resetMock.requestReset).toHaveBeenCalledWith("a@a.com");
      expect(res).toEqual({ ok: true });
    });
  });

  describe("resetPassword()", () => {
    it("chama reset.confirmReset e retorna ok", async () => {
      resetMock.confirmReset.mockResolvedValueOnce({ ok: true });

      const res = await controller.resetPassword({
        email: "a@a.com",
        code: "123456",
        newPassword: "123456",
      } as any);

      expect(resetMock.confirmReset).toHaveBeenCalledWith(
        "a@a.com",
        "123456",
        "123456",
      );
      expect(res).toEqual({ ok: true });
    });
  });
});