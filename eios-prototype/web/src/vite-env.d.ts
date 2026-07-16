/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin for a split deploy. Unset = same origin (dev proxy / single container). */
  readonly VITE_API_URL?: string
  /** Shared secret. Required when the backend sets EIOS_ACCESS_TOKEN (any non-localhost deploy). */
  readonly VITE_ACCESS_TOKEN?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
