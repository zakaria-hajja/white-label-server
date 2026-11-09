import { envelope } from "../helpers/http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/health/route";
import { createContainer, setContainer } from "@/core/container";
import { loadConfig } from "@/core/config/env";
import { createPrisma } from "@/core/database/prisma";

const ctx = { params: Promise.resolve({}) };

describe("GET /api/v1/health", () => {
  beforeAll(() => setContainer(null));
  afterAll(() => setContainer(null));

  it("reports db up", async () => {
    const res = await GET(new Request("http://localhost/api/v1/health"), ctx);
    const json = await envelope(res);
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ status: "ok", db: "up" });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("reports 503 degraded when the database is unreachable", async () => {
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:1/none",
    });
    setContainer(createContainer(config, { prisma: createPrisma(config.databaseUrl) }));
    const res = await GET(new Request("http://localhost/api/v1/health"), ctx);
    expect(res.status).toBe(503);
    expect((await envelope(res)).data).toEqual({ status: "degraded", db: "down" });
  });
});
