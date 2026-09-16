import { createAuth } from "@radar/auth";
import { createDb } from "@radar/db";

import { createApp } from "./app";
import { env } from "./env.server";

const db = createDb(env);
export default createApp(createAuth(env, db), env.CORS_ORIGIN, db);
