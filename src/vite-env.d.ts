/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Versão do package.json, injetada pelo Vite (ver vite.config.ts). */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_STATIC_DEMO?: string
  readonly VITE_TEST_HOOKS?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
