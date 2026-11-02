// Bundles the official Anthropic TypeScript SDK into a single browser ES module
// so the extension can load it without a build step at install time.
// Run: npm run build:vendor
import { build } from 'esbuild';

await build({
  stdin: {
    contents: "export { default } from '@anthropic-ai/sdk'; export * from '@anthropic-ai/sdk';",
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  minify: true,
  legalComments: 'eof',
  outfile: 'extension/vendor/anthropic-sdk.mjs',
  logLevel: 'info',
});
