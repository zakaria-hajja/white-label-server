import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { GET } from "@/app/api/v1/openapi.json/route";

beforeEach(() => {
  setContainer(createContainer(loadConfig(process.env), { prisma: testPrisma() }));
});

describe("GET /openapi.json", () => {
  it("serves the committed spec raw, without tenant or auth", async () => {
    const res = await GET(new Request("http://localhost/api/v1/openapi.json"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const served = (await res.json()) as { openapi: string; success?: unknown };
    expect(served.success).toBeUndefined(); // not enveloped
    expect(served).toEqual(
      JSON.parse(readFileSync(join(process.cwd(), "openapi/openapi.json"), "utf8")),
    );
  });
});
