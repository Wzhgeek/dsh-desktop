import { defineConfig } from 'tsdown'

/**
 * Browser platform modules shared by the shell's frozen module table. The
 * client bundle keeps these external so it resolves them through the injected
 * factory `require` instead of inlining a duplicate runtime instance.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

/**
 * The @dsh-desktop/client browser bundle: a closure-factory artifact the
 * client-modules loader hands to the shell module table. The node half is
 * emitted by tsc; this build produces only `lib/client.js`.
 */
export default defineConfig({
  name: '@dsh-desktop/client/client',
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: PLATFORM_MODULES,
    alwaysBundle: [/^lucide-react(?:\/|$)/],
    onlyBundle: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@dsh-desktop/client", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
