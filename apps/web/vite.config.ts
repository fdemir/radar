import { fileURLToPath } from "node:url";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), reactRouter()],
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          // Worker entry wrapping the React Router request handler; must be absolute
          input: fileURLToPath(new URL("./workers/app.ts", import.meta.url)),
        },
      },
    },
  },
});
