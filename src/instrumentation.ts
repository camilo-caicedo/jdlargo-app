export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Windows dev machines intermittently fail to resolve the Supabase pooler hostname via
    // the OS resolver (ENOTFOUND, especially under repeated connections like a hard reload).
    // Force IPv4-first resolution against public DNS servers, same workaround already applied
    // per-file in every *.test.ts — this applies it once for the actual running server.
    const dns = await import('dns');
    try {
      dns.setDefaultResultOrder('ipv4first');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch {
      // Non-fatal: worst case, the OS resolver is used as before.
    }
  }
}
