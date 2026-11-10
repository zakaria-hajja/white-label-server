import { exampleEnvelope } from "@/core/openapi/fixtures";
import { authFixtures } from "../auth/auth.examples";
import { toUserDto } from "../auth/user.dto";

export const usersBodyExamples = {
  updateMe: { firstName: "Alicia" },
  deleteMe: { password: "correct-horse-battery" },
  changePassword: {
    currentPassword: "correct-horse-battery",
    newPassword: "new-correct-horse-battery",
  },
};

export const usersExamples = {
  user: exampleEnvelope(toUserDto(authFixtures.user)),
  updated: exampleEnvelope(toUserDto({ ...authFixtures.user, ...usersBodyExamples.updateMe })),
};

/** Inputs that fail validation; the 400 examples are the real VALIDATION_ERROR for each. */
export const usersInvalidExamples = {
  updateMe: { firstName: "" },
  changePassword: { currentPassword: "correct-horse-battery", newPassword: "short" },
  deleteMe: { password: "" },
};
