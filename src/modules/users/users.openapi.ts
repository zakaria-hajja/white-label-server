import { SuccessEnvelope, registerOperation } from "@/core/openapi/components";
import { TAGS } from "@/core/openapi/registry";
import { EmptyEnvelope, User } from "../auth/auth.openapi";
import { changePasswordRateLimit, deleteAccountRateLimit } from "./users.handlers";
import { changePasswordBody, deleteMeBody, updateMeBody } from "./users.schemas";
import { usersBodyExamples, usersInvalidExamples, usersExamples } from "./users.examples";
import { authExamples } from "../auth/auth.examples";

export const UserEnvelope = SuccessEnvelope("UserEnvelope", User);
const base = { tag: TAGS.users, tenant: "required", auth: "required" } as const;

registerOperation({
  ...base,
  method: "get",
  path: "/api/v1/users/me",
  operationId: "usersGetMe",
  summary: "Get the current user's profile",
  success: [
    { status: 200, description: "The user", schema: UserEnvelope, example: usersExamples.user },
  ],
});

registerOperation({
  ...base,
  method: "patch",
  path: "/api/v1/users/me",
  operationId: "usersUpdateMe",
  summary: "Update the current user's profile",
  description: "Send at least one of firstName, lastName; null clears a name.",
  body: updateMeBody,
  bodyExample: usersBodyExamples.updateMe,
  invalidExample: usersInvalidExamples.updateMe,
  success: [
    {
      status: 200,
      description: "The updated user",
      schema: UserEnvelope,
      example: usersExamples.updated,
    },
  ],
});

registerOperation({
  ...base,
  method: "patch",
  path: "/api/v1/users/me/password",
  operationId: "usersChangePassword",
  summary: "Change the current user's password",
  description:
    "A wrong current password is INVALID_CREDENTIALS (401). On success every other session of the user is revoked; the caller's session and tokens stay valid.",
  body: changePasswordBody,
  bodyExample: usersBodyExamples.changePassword,
  invalidExample: usersInvalidExamples.changePassword,
  rateLimit: changePasswordRateLimit,
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
  method: "delete",
  path: "/api/v1/users/me",
  operationId: "usersDeleteMe",
  summary: "Delete the current user's account",
  description:
    "Permanently deletes the account and all its sessions and settings. Confirm with the current password. " +
    "A wrong password is INVALID_CREDENTIALS (401). The body is required (Content-Type: application/json). " +
    "Afterwards the old access and refresh tokens are rejected, and the email can register again.",
  body: deleteMeBody,
  bodyExample: usersBodyExamples.deleteMe,
  invalidExample: usersInvalidExamples.deleteMe,
  rateLimit: deleteAccountRateLimit,
  success: [
    {
      status: 200,
      description: "Account deleted",
      schema: EmptyEnvelope,
      example: authExamples.empty,
    },
  ],
});
