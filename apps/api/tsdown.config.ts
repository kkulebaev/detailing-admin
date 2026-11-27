import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // platform: 'node' turns on .mjs by default; Dockerfile, railway.json and `start` run dist/main.js
  fixedExtension: false,
  // shared ships raw .ts with no build step, so Node can't import it at runtime; a regex because
  // a string matches only the bare name, while the code imports subpaths (`shared/booking`)
  deps: { alwaysBundle: [/^@detailing-admin\/shared(\/|$)/] },
})
