import dns from 'dns';

// Resolve host using Google/Cloudflare DNS
export const customLookup: unknown = (
  hostname: string,
  options: dns.LookupOneOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
) => {
  let cb = callback;
  let opts: dns.LookupOneOptions = {};
  if (typeof options === 'function') {
    cb = options;
  } else if (typeof options === 'object') {
    opts = options;
  }
  const resolver = new dns.Resolver();
  resolver.setServers(['8.8.8.8', '1.1.1.1']);
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      dns.lookup(hostname, opts, cb);
    } else {
      cb(null, addresses[0], 4);
    }
  });
};