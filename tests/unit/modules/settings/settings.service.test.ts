import { beforeEach, describe, expect, it } from "vitest";
import { FakeSettingsRepository } from "../../../helpers/fakes/settings-repository.fake";
import { AppError } from "@/core/errors/app-error";
import type { TenantContext } from "@/core/tenant/tenant-context";
import type { AppConfigDocument } from "@/modules/app-config/app-config.schemas";
import type { AppConfigReader } from "@/modules/app-config/app-config.reader";
import { SettingsService } from "@/modules/settings/settings.service";
import { updateSettingsBody } from "@/modules/settings/settings.schemas";

const A: TenantContext = {
  tenantId: "00000000-0000-4000-8000-00000000000a",
  slug: "a",
  name: "A",
  source: "header",
};
const B: TenantContext = { ...A, tenantId: "00000000-0000-4000-8000-00000000000b", slug: "b" };
const auth = (userId: string) => ({ userId, tenantId: A.tenantId, sessionId: "s" });

const reader: AppConfigReader = {
  getDocument: (tenantId) =>
    Promise.resolve({
      runtime: {
        defaultLanguage: tenantId === A.tenantId ? "fr" : "en",
        supportedLanguages: ["en", "fr"],
        defaultTheme: tenantId === A.tenantId ? "DARK" : "SYSTEM",
      },
    } as AppConfigDocument),
};

let repo: FakeSettingsRepository;
let service: SettingsService;

beforeEach(() => {
  repo = new FakeSettingsRepository();
  service = new SettingsService(repo, reader);
});

describe("SettingsService.get", () => {
  it("returns tenant defaults without writing a row", async () => {
    expect(await service.get(A, auth("u1"))).toEqual({
      theme: "DARK",
      language: "fr",
      notifications: { push: true, email: true, marketing: false },
    });
    expect(repo.rows).toHaveLength(0);
  });

  it("tolerates a partial stored notifications object and ignores unknown keys", async () => {
    await repo.upsertForUser(A.tenantId, "u1", {
      theme: "LIGHT",
      language: "en",
      notificationPreferences: { marketing: true, junk: 1 },
    });
    expect(await service.get(A, auth("u1"))).toEqual({
      theme: "LIGHT",
      language: "en",
      notifications: { push: true, email: true, marketing: true },
    });
  });
});

describe("SettingsService.update", () => {
  it("merges theme onto defaults and leaves other fields", async () => {
    const dto = await service.update(A, auth("u1"), { theme: "LIGHT" });
    expect(dto).toEqual({
      theme: "LIGHT",
      language: "fr",
      notifications: { push: true, email: true, marketing: false },
    });
    expect(await service.get(A, auth("u1"))).toEqual(dto);
  });

  it("merges notifications shallowly", async () => {
    await service.update(A, auth("u1"), { notifications: { push: false } });
    const dto = await service.update(A, auth("u1"), { notifications: { marketing: true } });
    expect(dto.notifications).toEqual({ push: false, email: true, marketing: true });
  });

  it("rejects an unsupported language with details", async () => {
    const err = await service.update(A, auth("u1"), { language: "xx" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ path: "language", message: expect.any(String) }],
    });
    expect(repo.rows).toHaveLength(0);
  });

  it("isolates users and tenants", async () => {
    await service.update(A, auth("u1"), { theme: "LIGHT" });
    expect((await service.get(A, auth("u2"))).theme).toBe("DARK");
    expect((await service.get(B, auth("u1"))).theme).toBe("SYSTEM");
  });
});

describe("updateSettingsBody", () => {
  it.each([
    [{}],
    [{ theme: "BLUE" }],
    [{ language: "e" }],
    [{ language: "x".repeat(11) }],
    [{ notifications: {}, extra: 1 }],
    [{ notifications: { sms: true } }],
    [{ notifications: { push: "yes" } }],
  ])("rejects %j", (body) => {
    expect(updateSettingsBody.safeParse(body).success).toBe(false);
  });

  it("accepts a valid patch", () => {
    expect(
      updateSettingsBody.safeParse({
        theme: "DARK",
        language: "en",
        notifications: { push: false },
      }).success,
    ).toBe(true);
  });
});
