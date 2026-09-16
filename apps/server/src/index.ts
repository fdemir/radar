import { createAuth } from "@radar/auth";
import { createDb } from "@radar/db";

import { createApp } from "./app";
import { env } from "./env.server";

export default createApp(createAuth(env, createDb(env)), env.CORS_ORIGIN);
