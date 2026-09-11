import path from 'path';
import fs from 'fs';
import dns from 'dns';

// Load .env.test with precedence over everything else during testing
const testEnvPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(testEnvPath)) {
  const content = fs.readFileSync(testEnvPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // ignore
}

// Fallback lookup hook for supabase pooler if windows dns fails
const originalLookup = dns.lookup;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(dns as any).lookup = function (hostname: string, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'aws-0-us-east-2.pooler.supabase.com') {
    return originalLookup(hostname, options, (err, address, family) => {
      if (err) {
        if (options && options.all) {
          return callback(null, [{ address: '3.13.175.194', family: 4 }]);
        }
        return callback(null, '3.13.175.194', 4);
      }
      return callback(err, address, family);
    });
  }
  return originalLookup(hostname, options, callback);
};