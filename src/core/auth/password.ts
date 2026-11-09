import { hash, verify } from "@node-rs/argon2";

// The library default algorithm is Argon2id (asserted in the unit test); parameters per global constraints.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash
  }
}

// Precomputed with the same parameters; lets login paths spend equal time when the user does not exist.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$meJstR3DcU7CccFPV3cgew$ZACook2I8mBfPDYt08C3MMz4fRCISer/ASk0oy67d3o";

export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, password);
}
