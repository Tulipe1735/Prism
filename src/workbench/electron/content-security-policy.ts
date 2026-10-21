import { CLERK_FRONTEND_HOST } from "./identity-config.ts";

/** Keep Excalidraw's generated font bindings inside its dedicated worker. */
export function rendererContentSecurityPolicy(pathname: string): string {
  if (/^\/subset-worker\.chunk-[\w-]+\.js$/.test(pathname))
    return [
      "default-src 'none'",
      "script-src 'self' 'unsafe-eval'",
      "connect-src 'self'",
    ].join("; ");

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://${CLERK_FRONTEND_HOST} https://challenges.cloudflare.com https://*.protect.clerk.com`,
    `connect-src 'self' https://${CLERK_FRONTEND_HOST} https://*.protect.clerk.com:* https://clerk-telemetry.com https://*.clerk-telemetry.com`,
    "img-src 'self' https://img.clerk.com data:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}
