// Unit tests that create throwaway git repos (githooks, base-openapi) must only touch those repos.
// Git exports GIT_DIR (and friends) to hooks when you push from a linked worktree, and every git
// command a test spawns would follow it into the real repo: `git init` there sets core.bare, and
// fixture commits land on the branch being pushed. Drop the variables that tell git which repo it's
// in, so each spawned git command finds its repo from its cwd. The list is
// `git rev-parse --local-env-vars`.
const GIT_REPO_ENV = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

for (const name of GIT_REPO_ENV) delete process.env[name];
