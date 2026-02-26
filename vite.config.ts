import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    target: "esnext",
    outDir: "dist",
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // JS в отдельную папку чтобы не конфликтовать с game assets
        entryFileNames: "js/[name]-[hash].js",
        chunkFileNames: "js/[name]-[hash].js",
        assetFileNames: "js/[name]-[hash].[ext]",
      },
    },
  },
  server: {
    port: 8080,
    open: true,
  },
});
