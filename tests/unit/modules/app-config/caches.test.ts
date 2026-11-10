import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/core/errors/app-error";
import type { Clock } from "@/shared/clock";
import type { AppConfigDocument } from "@/modules/app-config/app-config.schemas";
import type { AppConfigReader } from "@/modules/app-config/app-config.reader";
import { CachedAppConfigReader } from "@/modules/app-config/app-config.reader";
import {
  CachedFeatureFlags,
  requireFeature,
  type FeatureFlags,
  type FlagSource,
} from "@/modules/app-config/feature-flags";

function clockAt() {
  let t = 1_000_000;
  const clock: Clock = { now: () => new Date(t) };
  return { clock, advance: (ms: number) => (t += ms) };
}

describe("CachedAppConfigReader", () => {
  const doc = { app: { displayName: "A" } } as AppConfigDocument;

  it("serves from cache within 30 s and refetches after", async () => {
    const { clock, advance } = clockAt();
    const getDocument = vi.fn().mockResolvedValue(doc);
    const reader = new CachedAppConfigReader({ getDocument } as AppConfigReader, clock);
    await reader.getDocument("t1");
    advance(29_000);
    await reader.getDocument("t1");
    expect(getDocument).toHaveBeenCalledTimes(1);
    advance(1_001);
    await reader.getDocument("t1");
    expect(getDocument).toHaveBeenCalledTimes(2);
    await reader.getDocument("t2");
    expect(getDocument).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures and invalidate() clears", async () => {
    const { clock } = clockAt();
    const getDocument = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(doc);
    const reader = new CachedAppConfigReader({ getDocument } as AppConfigReader, clock);
    await expect(reader.getDocument("t1")).rejects.toThrow();
    await reader.getDocument("t1");
    await reader.getDocument("t1");
    expect(getDocument).toHaveBeenCalledTimes(2);
    reader.invalidate();
    await reader.getDocument("t1");
    expect(getDocument).toHaveBeenCalledTimes(3);
  });
});

describe("CachedFeatureFlags", () => {
  it("caches all() for 30 s, unknown key is false, invalidate() clears", async () => {
    const { clock, advance } = clockAt();
    const load = vi.fn().mockResolvedValue({ catalog: true, beta: false });
    const flags = new CachedFeatureFlags({ load } as FlagSource, clock);
    expect(await flags.all("t1")).toEqual({ catalog: true, beta: false });
    expect(await flags.isEnabled("t1", "catalog")).toBe(true);
    expect(await flags.isEnabled("t1", "beta")).toBe(false);
    expect(await flags.isEnabled("t1", "nope")).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    advance(30_001);
    await flags.all("t1");
    expect(load).toHaveBeenCalledTimes(2);
    flags.invalidate();
    await flags.all("t1");
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("requireFeature", () => {
  const make = (tenant: unknown, enabled: boolean) =>
    ({
      tenant,
      container: {
        featureFlags: { isEnabled: () => Promise.resolve(enabled) } as unknown as FeatureFlags,
      },
    }) as never;

  it("passes when enabled", async () => {
    await expect(requireFeature(make({ tenantId: "t" }, true), "catalog")).resolves.toBeUndefined();
  });
  it("throws FEATURE_DISABLED when disabled", async () => {
    await expect(requireFeature(make({ tenantId: "t" }, false), "catalog")).rejects.toMatchObject({
      code: "FEATURE_DISABLED",
    });
  });
  it("throws an internal error without a tenant", async () => {
    const err = await requireFeature(make(null, true), "catalog").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
  });
});
