import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Anchor/web3.js esperan `global` y `Buffer` de Node en el navegador.
export default defineConfig({
  plugins: [react()],
  define: { global: "globalThis" },
  resolve: { alias: { buffer: "buffer/" } },
});
