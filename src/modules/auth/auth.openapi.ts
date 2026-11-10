import { z } from "zod";
import { SuccessEnvelope, registerOperation } from "@/core/openapi/components";
import { registry, TAGS } from "@/core/openapi/registry";
import { zIdParams } from "@/core/validation/common";
import {
  forgotPasswordBody,
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
  TokenPairSchema,
} from "./auth.schemas";
import {
  forgotPasswordRateLimit,
  loginRateLimit,
  refreshRateLimit,
  registerRateLimit,
  resetPasswordRateLimit,
} from "./auth.handlers";
import { SessionDtoSchema, UserDtoSchema } from "./user.dto";
import {
  authBodyExamples,
  authInvalidExamples,
  authErrorExamples,
  authExamples,
} from "./auth.examples";

export const User = registry.register("UserDto", UserDtoSchema);
const TokenPair = registry.register("TokenPair", TokenPairSchema);
const Session = registry.register("SessionDto", SessionDtoSchema);

export const AuthResultEnvelope = SuccessEnvelope(
  "AuthResultEnvelope",
  z.object({ user: User, tokens: TokenPair }),
);
export const TokensEnvelope = SuccessEnvelope("TokensEnvelope", z.object({ tokens: TokenPair }));
export const EmptyEnvelope = SuccessEnvelope("EmptyEnvelope", z.object({}));
export const MeEnvelope = SuccessEnvelope(
  "MeEnvelope",
  z.object({
    user: User,
    tenant: z.object({ slug: z.string(), name: z.string() }),
    session: z.object({ id: z.uuid(), expiresAt: z.iso.datetime() }),
  }),
);
export const SessionsEnvelope = SuccessEnvelope(
  "SessionsEnvelope",
  z.object({ sessions: z.array(Session) }),
);

const A = "/api/v1/auth";
const base = { tag: TAGS.auth, tenant: "required" } as const;

registerOperation({
  ...base,
  method: "post",
  path: `${A}/register`,
  operationId: "authRegister",
  summary: "Register a user and sign in",
  auth: "none",
  body: registerBody,
  bodyExample: authBodyExamples.register,
  invalidExample: authInvalidExamples.register,
  rateLimit: registerRateLimit,
  success: [
    {
      status: 201,
      description: "User created; session started",
      schema: AuthResultEnvelope,
      example: authExamples.authResult,
    },
  ],
  extraErrors: [409],
});

registerOperation({
  ...base,
  method: "post",
  path: `${A}/login`,
  operationId: "authLogin",
  summary: "Sign in with email and password",
  description:
    "A wrong password, unknown email, disabled or locked account all return INVALID_CREDENTIALS.",
  auth: "none",
  body: loginBody,
  bodyExample: authBodyExamples.login,
  invalidExample: authInvalidExamples.login,
  rateLimit: loginRateLimit,
  success: [
    {
      status: 200,
      description: "Signed in",
      schema: AuthResultEnvelope,
      example: authExamples.authResult,
    },
  ],
  extraErrors: [401],
  errorExamples: authErrorExamples.login,
});

registerOperation({
  ...base,
  method: "post",
  path: `${A}/refresh`,
  operationId: "authRefresh",
  summary: "Exchange a refresh token for a new token pair",
  description:
    "Refresh tokens are single-use. If a response is lost, retrying once with the old token within 10 s returns a fresh pair and supersedes the lost one (a superseded token gets 401 without revoking the session). Reusing a spent token after 10 s revokes the session.",
  auth: "none",
  body: refreshBody,
  bodyExample: authBodyExamples.refresh,
  invalidExample: authInvalidExamples.refresh,
  rateLimit: refreshRateLimit,
  success: [
    {
      status: 200,
      description: "New token pair",
      schema: TokensEnvelope,
      example: authExamples.tokens,
    },
  ],
  extraErrors: [401],
  errorExamples: authErrorExamples.refresh,
});

registerOperation({
  ...base,
  method: "post",
  path: `${A}/logout`,
  operationId: "authLogout",
  summary: "Revoke the session of a refresh token",
  auth: "none",
  body: logoutBody,
  bodyExample: authBodyExamples.logout,
  invalidExample: authInvalidExamples.logout,
  success: [
    {
      status: 200,
      description: "Session revoked (idempotent)",
      schema: EmptyEnvelope,
      example: authExamples.empty,
    },
  ],
});

registerOperation({
  ...base,
  method: "post",
  path: `${A}/forgot-password`,
  operationId: "authForgotPassword",
  summary: "Request a password reset email",
  description: "Always 202, whether or not the email is registered.",
  auth: "none",
  body: forgotPasswordBody,
  bodyExample: authBodyExamples.forgotPassword,
  invalidExample: authInvalidExamples.forgotPassword,
  rateLimit: forgotPasswordRateLimit,
  success: [
    { status: 202, description: "Accepted", schema: EmptyEnvelope, example: authExamples.empty },
  ],
});

registerOperation({
  ...base,
  method: "post",
  path: `${A}/reset-password`,
  operationId: "authResetPassword",
  summary: "Set a new password with a reset token",
  description:
    "An invalid, expired or used token is INVALID_RESET_TOKEN (400). All sessions are revoked.",
  auth: "none",
  body: resetPasswordBody,
  bodyExample: authBodyExamples.resetPassword,
  invalidExample: authInvalidExamples.resetPassword,
  rateLimit: resetPasswordRateLimit,
  success: [
    {
      status: 200,
      description: "Password changed",
      schema: EmptyEnvelope,
      example: authExamples.empty,
    },
  ],
});

registerOperation({
  ...base,
  method: "get",
  path: `${A}/me`,
  operationId: "authMe",
  summary: "Current user, tenant and session",
  auth: "required",
  success: [
    { status: 200, description: "Current identity", schema: MeEnvelope, example: authExamples.me },
  ],
});

registerOperation({
  ...base,
  method: "get",
  path: `${A}/sessions`,
  operationId: "authSessionsList",
  summary: "List the user's active sessions",
  auth: "required",
  success: [
    {
      status: 200,
      description: "Active sessions",
      schema: SessionsEnvelope,
      example: authExamples.sessions,
    },
  ],
});

registerOperation({
  ...base,
  method: "delete",
  path: `${A}/sessions/{id}`,
  operationId: "authSessionsRevoke",
  summary: "Revoke one of the user's sessions",
  auth: "required",
  params: zIdParams,
  success: [
    {
      status: 200,
      description: "Session revoked",
      schema: EmptyEnvelope,
      example: authExamples.empty,
    },
  ],
});
