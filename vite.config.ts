import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import cesiumImport from 'vite-plugin-cesium'

// vite-plugin-cesium is CommonJS and exposes its factory as `.default`. Under
// TypeScript's ESM interop the default import can resolve to the namespace
// object rather than the callable, so unwrap it at runtime rather than
// assuming one shape. Routed through `unknown` because the two shapes do not
// structurally overlap and TypeScript is right to say so.
const mod = cesiumImport as unknown as
  | (() => PluginOption)
  | { default: () => PluginOption }
const cesium = typeof mod === 'function' ? mod : mod.default

// https://vite.dev/config/
export default defineConfig({
  // Cesium ships Workers, Assets and Widgets directories that must be served
  // alongside the app. The plugin copies them into the build and sets
  // CESIUM_BASE_URL -- without it the app builds cleanly and then fails at
  // runtime looking for those files, which is the usual way a Cesium
  // deployment breaks.
  plugins: [react(), cesium()],
})
