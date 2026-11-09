import { afterAll, beforeEach } from "vitest";
import { disconnectDb, resetDb } from "../helpers/db";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
});
