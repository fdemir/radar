import { createAuth as createConfiguredAuth } from "@radar/auth";
import { type Database, createDb } from "@radar/db";

import { env } from "./env.server";

export function getDb(): Database {
  return createDb(env);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(env, database ?? (await getDb()));
}
