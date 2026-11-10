import { describe, expect, it } from "vitest";
// Must stay first: Zod 4 schemas created before extendZodWithOpenApi() (run by the registry module)
// lack `.openapi()`, so the registry has to load before any schema module.
import "@/core/openapi/registry";
import { pino } from "pino";
import { FakeAuthRepository } from "../../helpers/fakes/auth-repository.fake";
import { FakeCatalogRepository } from "../../helpers/fakes/catalog-repository.fake";
import { FakeSettingsRepository } from "../../helpers/fakes/settings-repository.fake";
import { resetDeps } from "../../helpers/fakes/reset-deps";
import { ok } from "@/core/http/envelope";
import { HealthDtoSchema } from "@/core/http/health";
import { defaultAppConfig } from "@/core/tenant/tenant-admin.service";
import type { TenantContext } from "@/core/tenant/tenant-context";
import { AppConfigService } from "@/modules/app-config/app-config.service";
import { AppConfigEnvelope } from "@/modules/app-config/app-config.openapi";
import { AuthService } from "@/modules/auth/auth.service";
import {
  AuthResultEnvelope,
  MeEnvelope,
  SessionsEnvelope,
  TokensEnvelope,
} from "@/modules/auth/auth.openapi";
import { toSessionDto, toUserDto, SessionDtoSchema, UserDtoSchema } from "@/modules/auth/user.dto";
import { toCatalogItemDto, CatalogItemDtoSchema } from "@/modules/catalog/catalog.dto";
import { CatalogItemEnvelope, CatalogListEnvelope } from "@/modules/catalog/catalog.openapi";
import { CatalogService } from "@/modules/catalog/catalog.service";
import { SettingsEnvelope } from "@/modules/settings/settings.openapi";
import { SettingsService } from "@/modules/settings/settings.service";
import { UserEnvelope } from "@/modules/users/users.openapi";
import type { AppConfigReader } from "@/modules/app-config/app-config.reader";
import { HealthEnvelope } from "@/core/openapi/system.openapi";
import { FIXTURE_IDS, FIXTURE_NOW, FIXTURE_TENANT } from "@/core/openapi/fixtures";
import { appConfigExample, appConfigFixtures } from "@/modules/app-config/app-config.examples";
import { authBodyExamples, authExamples, authFixtures } from "@/modules/auth/auth.examples";
import { hashPassword } from "@/core/auth/password";
import { catalogExamples, catalogFixtures } from "@/modules/catalog/catalog.examples";
import {
  settingsBodyExample,
  settingsExamples,
  settingsFixtures,
} from "@/modules/settings/settings.examples";
import { usersBodyExamples, usersExamples } from "@/modules/users/users.examples";
import { UsersService } from "@/modules/users/users.service";
import { FakeUsersRepository } from "../../helpers/fakes/users-repository.fake";

/**
 * Real mapper/service output, wrapped by the real `ok()` and parsed against the schemas the OpenAPI
 * spec is generated from. If a DTO changes without its response schema (or vice versa) this fails.
 */
const T: TenantContext = { tenantId: "t-1", slug: "acme", name: "Acme", source: "header" };
const cfg = {
  jwt: {
    secret: new TextEncoder().encode("test-jwt-secret-test-jwt-secret-0123456789"),
    issuer: "whitelabel-api",
    audience: "whitelabel-api" as const,
    accessTtlSeconds: 900,
  },
  sessionTtlDays: 30,
};
const clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const META = { userAgent: "UA", ip: "unknown" };

async function body(data: unknown, opts: Parameters<typeof ok>[1] = { requestId: "req-12345678" }) {
  return (await ok(data, opts).json()) as unknown;
}

const reader: AppConfigReader = {
  getDocument: () => Promise.resolve(defaultAppConfig("Acme")),
};

describe("response DTOs match their OpenAPI response schemas", () => {
  it("user, session and catalog mappers", () => {
    const d = new Date("2026-01-02T03:04:05.678Z");
    const user = toUserDto({
      id: crypto.randomUUID(),
      email: "a@b.co",
      firstName: null,
      lastName: "L",
      status: "ACTIVE",
      createdAt: d,
    });
    expect(UserDtoSchema.safeParse(user).success).toBe(true);
    const sid = crypto.randomUUID();
    expect(
      SessionDtoSchema.safeParse(
        toSessionDto({ id: sid, userAgent: null, createdAt: d, lastUsedAt: d }, sid),
      ).success,
    ).toBe(true);
    const item = toCatalogItemDto({
      id: crypto.randomUUID(),
      title: "T",
      description: null,
      category: "c",
      imageUrl: null,
      createdAt: d,
      updatedAt: d,
    });
    expect(CatalogItemDtoSchema.safeParse(item).success).toBe(true);
  });

  it("auth service results (register/login/refresh/me/sessions)", async () => {
    const repo = new FakeAuthRepository();
    const service = new AuthService(repo, cfg, clock, resetDeps);
    const registered = await service.register(
      T,
      { email: "a@b.co", password: "correct-horse-1" },
      META,
    );
    expect(
      AuthResultEnvelope.parse(await body(registered, { status: 201, requestId: "req-12345678" })),
    ).toBeTruthy();
    const login = await service.login(T, { email: "a@b.co", password: "correct-horse-1" }, META);
    expect(AuthResultEnvelope.safeParse(await body(login)).success).toBe(true);
    const tokens = await service.refresh(T, login.tokens.refreshToken);
    expect(TokensEnvelope.safeParse(await body({ tokens })).success).toBe(true);
    const session = repo.sessions[0];
    expect(session).toBeDefined();
    const auth = { userId: registered.user.id, tenantId: T.tenantId, sessionId: session?.id ?? "" };
    expect(MeEnvelope.safeParse(await body(await service.me(T, auth))).success).toBe(true);
    const sessions = await service.listSessions(T, auth);
    expect(sessions.length).toBeGreaterThan(0);
    expect(SessionsEnvelope.safeParse(await body({ sessions })).success).toBe(true);
    expect(UserEnvelope.safeParse(await body(registered.user)).success).toBe(true);
  });

  it("settings service output (defaults and updated)", async () => {
    const service = new SettingsService(new FakeSettingsRepository(), reader);
    const auth = { userId: "u1", tenantId: T.tenantId, sessionId: "s" };
    expect(SettingsEnvelope.safeParse(await body(await service.get(T, auth))).success).toBe(true);
    const updated = await service.update(T, auth, {
      theme: "DARK",
      notifications: { push: false },
    });
    expect(SettingsEnvelope.safeParse(await body(updated)).success).toBe(true);
  });

  it("catalog service output (page and single item)", async () => {
    const repo = new FakeCatalogRepository();
    repo.rows.push({
      id: crypto.randomUUID(),
      tenantId: T.tenantId,
      title: "Item",
      description: null,
      category: null,
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new CatalogService(repo);
    const { items, pagination } = await service.list(T, {
      page: 1,
      pageSize: 20,
      q: undefined,
      sort: "createdAt:desc",
    });
    expect(
      CatalogListEnvelope.safeParse(await body(items, { requestId: "req-12345678", pagination }))
        .success,
    ).toBe(true);
    const first = items[0];
    expect(
      CatalogItemEnvelope.safeParse(await body(await service.get(T, first?.id ?? ""))).success,
    ).toBe(true);
  });

  it("app config service output (with a fake reader)", async () => {
    const service = new AppConfigService(reader, {
      all: () => Promise.resolve({ catalog: true, beta: false }),
    } as never);
    expect(AppConfigEnvelope.safeParse(await body(await service.getPublic(T))).success).toBe(true);
  });

  it("health report", async () => {
    expect(HealthEnvelope.safeParse(await body({ status: "degraded", db: "down" })).success).toBe(
      true,
    );
    expect(HealthDtoSchema.safeParse({ status: "ok", db: "up" }).success).toBe(true);
  });

  it("rejects an envelope with a leaked field shape (sanity)", async () => {
    expect(UserEnvelope.safeParse(await body({ id: "x" })).success).toBe(false);
    void pino;
  });
});

/**
 * Review Focus 2: each spec example is the real service output on the same fixture. If a DTO gains
 * a field and its example isn't regenerated from the mapper, these fail.
 */
describe("spec examples equal the real service output on their fixtures", () => {
  const ctx: TenantContext = {
    tenantId: FIXTURE_IDS.tenant,
    slug: FIXTURE_TENANT.slug,
    name: FIXTURE_TENANT.name,
    source: "header",
  };
  const auth = {
    userId: FIXTURE_IDS.user,
    tenantId: FIXTURE_IDS.tenant,
    sessionId: FIXTURE_IDS.session,
  };
  const fixtureReader: AppConfigReader = {
    getDocument: () => Promise.resolve(appConfigFixtures.document),
  };
  const fixedClock = { now: () => FIXTURE_NOW };

  function authRepo() {
    const repo = new FakeAuthRepository(() => FIXTURE_NOW);
    repo.users.push({
      ...authFixtures.user,
      tenantId: FIXTURE_IDS.tenant,
      passwordHash: "x",
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: authFixtures.user.createdAt,
      updatedAt: authFixtures.user.createdAt,
    });
    for (const s of authFixtures.sessions) {
      repo.sessions.push({
        ...s,
        tenantId: FIXTURE_IDS.tenant,
        userId: FIXTURE_IDS.user,
        ipAddress: null,
        revokedAt: null,
        revokedReason: null,
      });
    }
    return repo;
  }

  it("me and sessions", async () => {
    const service = new AuthService(authRepo(), cfg, fixedClock, resetDeps);
    expect(await service.me(ctx, auth)).toEqual(authExamples.me.data);
    expect({ sessions: await service.listSessions(ctx, auth) }).toEqual(authExamples.sessions.data);
  });

  it("register, login and refresh results (token values are opaque, so they are swapped)", async () => {
    const opaque = (t: { accessToken: string; refreshToken: string }) => ({
      ...t,
      accessToken: authFixtures.tokens.accessToken,
      refreshToken: authFixtures.tokens.refreshToken,
    });
    const repo = authRepo();
    const user = repo.users[0];
    if (user) user.passwordHash = await hashPassword(authBodyExamples.login.password);
    const service = new AuthService(repo, cfg, fixedClock, resetDeps);

    const login = await service.login(ctx, authBodyExamples.login, META);
    expect({ ...login, tokens: opaque(login.tokens) }).toEqual(authExamples.authResult.data);

    const tokens = await service.refresh(ctx, login.tokens.refreshToken);
    expect({ tokens: opaque(tokens) }).toEqual(authExamples.tokens.data);

    const fresh = new AuthService(
      new FakeAuthRepository(() => FIXTURE_NOW),
      cfg,
      fixedClock,
      resetDeps,
    );
    const registered = await fresh.register(ctx, authBodyExamples.register, META);
    expect({
      user: {
        ...registered.user,
        id: FIXTURE_IDS.user,
        createdAt: authExamples.authResult.data.user.createdAt,
      },
      tokens: opaque(registered.tokens),
    }).toEqual(authExamples.authResult.data);
  });

  it("users me and updated me", async () => {
    const service = new UsersService(new FakeUsersRepository(authRepo()), fixedClock);
    expect(await service.getMe(ctx, auth)).toEqual(usersExamples.user.data);
    expect(await service.updateMe(ctx, auth, usersBodyExamples.updateMe)).toEqual(
      usersExamples.updated.data,
    );
  });

  it("settings defaults and stored values", async () => {
    const empty = new SettingsService(new FakeSettingsRepository(), fixtureReader);
    expect(await empty.get(ctx, auth)).toEqual(settingsExamples.defaults.data);
    const repo = new FakeSettingsRepository();
    await repo.upsertForUser(ctx.tenantId, auth.userId, settingsFixtures.stored);
    const stored = new SettingsService(repo, fixtureReader);
    expect(await stored.get(ctx, auth)).toEqual(settingsExamples.stored.data);
    expect(await stored.update(ctx, auth, settingsBodyExample)).toEqual(
      settingsExamples.stored.data,
    );
  });

  it("public app config", async () => {
    const service = new AppConfigService(fixtureReader, {
      all: () => Promise.resolve({ ...appConfigFixtures.features }),
    });
    expect(await service.getPublic(ctx)).toEqual(appConfigExample.data);
  });

  it("catalog page and item", async () => {
    const repo = new FakeCatalogRepository();
    for (const item of catalogFixtures.items) repo.rows.push({ ...item, tenantId: ctx.tenantId });
    const service = new CatalogService(repo);
    const { items, pagination } = await service.list(ctx, catalogFixtures.query);
    expect(items).toEqual(catalogExamples.page.data);
    expect(pagination).toEqual(catalogExamples.page.meta.pagination);
    const first = catalogFixtures.items[0];
    expect(await service.get(ctx, first?.id ?? "")).toEqual(catalogExamples.item.data);
  });
});
