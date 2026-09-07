import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
    main: {
        plugins: [
            // Bundle yaml, smol-toml, and zod so the packaged app does not depend on
            // the development node_modules layout inside the asar.
            externalizeDepsPlugin({ exclude: ["yaml", "smol-toml", "zod", "fflate"] }),
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
        build: { minify: "esbuild", cssMinify: true },
        resolve: {
            alias: {
                "@": resolve("src/renderer/src"),
                "@shared": resolve("src/shared"),
            },
        },
        plugins: [react()],
    },
});
