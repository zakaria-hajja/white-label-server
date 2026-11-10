import { describe, expect, it } from "vitest";
import { APP_NAMESPACE, checkRoutes, STARTER_ROUTES } from "@/core/contract/starter-routes";
import { discoverRoutes } from "../../helpers/routes";

describe("starter routes and the x/ app namespace", () => {
  it("every route is a listed starter route or lives under /api/v1/x/", async () => {
    const discovered = (await discoverRoutes()).map((r) => r.key);
    expect(checkRoutes(discovered, STARTER_ROUTES)).toEqual([]);
  });

  it("the list is sorted, unique and never under x/", () => {
    expect([...STARTER_ROUTES]).toEqual([...new Set(STARTER_ROUTES)].sort());
    expect(STARTER_ROUTES.filter((k) => k.split(" ")[1]?.startsWith(APP_NAMESPACE))).toEqual([]);
  });

  it("includes health and the spec route", () => {
    expect(STARTER_ROUTES).toContain("GET /api/v1/health");
    expect(STARTER_ROUTES).toContain("GET /api/v1/openapi.json");
  });
});

describe("checkRoutes (Review Focus 3)", () => {
  const starter = ["GET /api/v1/health", "GET /api/v1/users/me"];

  it("reports an unlisted starter route with a fix hint", () => {
    const problems = checkRoutes(
      ["GET /api/v1/health", "GET /api/v1/users/me", "POST /api/v1/foo"],
      starter,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("POST /api/v1/foo");
    expect(problems[0]).toContain(
      "add starter routes to STARTER_ROUTES; app routes belong under /api/v1/x/",
    );
  });

  it("reports a new method on a listed path", () => {
    const problems = checkRoutes([...starter, "DELETE /api/v1/users/me"], starter);
    expect(problems.join("\n")).toContain("DELETE /api/v1/users/me");
  });

  it("reports a starter list entry under x/", () => {
    const problems = checkRoutes(
      [...starter, "GET /api/v1/x/bar"],
      [...starter, "GET /api/v1/x/bar"],
    );
    expect(problems.join("\n")).toContain("GET /api/v1/x/bar");
    expect(problems.join("\n")).toMatch(/must not list/);
  });

  it("reports a stale entry", () => {
    const problems = checkRoutes(["GET /api/v1/health"], starter);
    expect(problems.join("\n")).toContain("GET /api/v1/users/me");
    expect(problems.join("\n")).toMatch(/stale/);
  });

  it("allows unlisted app routes under x/", () => {
    expect(
      checkRoutes([...starter, "GET /api/v1/x/notes", "POST /api/v1/x/notes/{id}"], starter),
    ).toEqual([]);
  });

  it("does not treat /api/v1/xyz as the app namespace", () => {
    expect(checkRoutes([...starter, "GET /api/v1/xyz"], starter)).toHaveLength(1);
  });
});
