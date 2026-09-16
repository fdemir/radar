import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

import { ENV } from "../env.public";

export const authClient = createAuthClient({
  baseURL: ENV.VITE_SERVER_URL,
  plugins: [usernameClient({ displayUsername: false })],
});
