import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/health/route";

describe("health stub", () => {
  it("GET returns status 200", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
