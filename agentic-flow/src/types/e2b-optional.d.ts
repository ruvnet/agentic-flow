/**
 * E2B is an optional runtime integration loaded dynamically by the SDK.
 * Keep the base package type-checkable without forcing cloud-sandbox clients
 * into every installation.
 */
declare module 'e2b' {
  export const Sandbox: any;
}

declare module '@e2b/code-interpreter' {
  export const Sandbox: any;
}
