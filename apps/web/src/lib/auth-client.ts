import { createAuthClient } from "better-auth/react";

import { ENV } from "../env.public";

export const authClient = createAuthClient({
  baseURL: ENV.VITE_SERVER_URL,
});
