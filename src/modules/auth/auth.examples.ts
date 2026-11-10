import { exampleEnvelope, FIXTURE_IDS, FIXTURE_TENANT } from "@/core/openapi/fixtures";
import { errorExamples } from "@/core/openapi/system.examples";
import type { TokenPair } from "./auth.schemas";
import { toSessionDto, toUserDto } from "./user.dto";

const created = new Date("2025-12-01T09:30:00.000Z");

/** Fixed inputs; `tests/unit/openapi/dto-contract.test.ts` feeds the same ones to the services. */
export const authFixtures = {
  user: {
    id: FIXTURE_IDS.user,
    email: "alice@shared.test",
    firstName: "Alice",
    lastName: "Anderson",
    status: "ACTIVE",
    createdAt: created,
  },
  /** Ordered most recently used first, as the sessions list returns them. */
  sessions: [
    {
      id: FIXTURE_IDS.session,
      userAgent: "Showcase/1.0 (Android 15)",
      createdAt: new Date("2025-12-20T08:00:00.000Z"),
      lastUsedAt: new Date("2025-12-31T18:45:00.000Z"),
      expiresAt: new Date("2026-01-30T18:45:00.000Z"),
    },
    {
      id: FIXTURE_IDS.otherSession,
      userAgent: null,
      createdAt: new Date("2025-12-02T10:00:00.000Z"),
      lastUsedAt: new Date("2025-12-15T12:00:00.000Z"),
      expiresAt: new Date("2026-01-14T12:00:00.000Z"),
    },
  ],
  /** Fixed values in the real shapes: a JWT, and 32 bytes base64url for the refresh token. */
  tokens: {
    accessToken:
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMTk1MDAwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAxMDEifQ.c2lnbmF0dXJl",
    refreshToken: "ZXhhbXBsZS1yZWZyZXNoLXRva2VuLW5vdC1yZWFsISE",
    tokenType: "Bearer",
    expiresIn: 900,
  } satisfies TokenPair,
};

const user = toUserDto(authFixtures.user);
const current = authFixtures.sessions[0] as (typeof authFixtures.sessions)[number];

export const authExamples = {
  authResult: exampleEnvelope({ user, tokens: authFixtures.tokens }),
  tokens: exampleEnvelope({ tokens: authFixtures.tokens }),
  empty: exampleEnvelope({}),
  me: exampleEnvelope({
    user,
    tenant: { slug: FIXTURE_TENANT.slug, name: FIXTURE_TENANT.name },
    session: { id: current.id, expiresAt: current.expiresAt.toISOString() },
  }),
  sessions: exampleEnvelope({
    sessions: authFixtures.sessions.map((s) => toSessionDto(s, FIXTURE_IDS.session)),
  }),
};

export const authBodyExamples = {
  register: {
    email: "alice@shared.test",
    password: "correct-horse-battery",
    firstName: "Alice",
    lastName: "Anderson",
  },
  login: { email: "alice@shared.test", password: "correct-horse-battery" },
  refresh: { refreshToken: authFixtures.tokens.refreshToken },
  logout: { refreshToken: authFixtures.tokens.refreshToken },
  forgotPassword: { email: "alice@shared.test" },
  resetPassword: {
    token: "ZXhhbXBsZS1yZXNldC10b2tlbi1ub3QtYS1yZWFsLTE",
    newPassword: "new-correct-horse-battery",
  },
};

export const authErrorExamples = {
  login: { 401: errorExamples.invalidCredentials },
  refresh: { 401: errorExamples.invalidRefreshToken },
};

/** Inputs that fail validation; the 400 examples are the real VALIDATION_ERROR for each. */
export const authInvalidExamples = {
  register: { email: "alice@", password: "short" },
  login: { email: "alice", password: "correct-horse-battery" },
  refresh: { refreshToken: "" },
  logout: { refreshToken: "" },
  forgotPassword: { email: "" },
  resetPassword: { token: authBodyExamples.resetPassword.token, newPassword: "short" },
};
