import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend talks only to the local backend (localhost:8000). No proxy needed;
// CORS is open on the backend for dev.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
