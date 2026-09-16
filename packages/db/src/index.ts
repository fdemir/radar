import { drizzle } from "drizzle-orm/d1";

import type { DatabaseConfig } from "./config";
import * as schema from "./schema";

export function createDb(env: DatabaseConfig) {
  return drizzle(env.DB, { schema });
}

export type Database = ReturnType<typeof createDb>;
