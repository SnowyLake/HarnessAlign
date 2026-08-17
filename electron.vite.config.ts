import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
    main: {
        plugins: [
            // Bundle yaml, smol-toml, and zod so the packaged app does not depend on
            // pnpm's node_modules layout inside the asar.
            externalizeDepsPlugin({ exclude: ["yaml", "smol-toml", "zod"] }),
        ],
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                output: {
                    format: "cjs",
                    entryFileNames: "[name].js",
                },
            },
        },
    },
    renderer: {
        resolve: {
            alias: {
                "@": resolve("src/renderer/src"),
                "@shared": resolve("src/shared"),
            },
        },
        plugins: [react(), tailwindcss()],
    },
});
