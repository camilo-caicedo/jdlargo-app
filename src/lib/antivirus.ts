import NodeClam from 'clamscan';
import { Readable } from 'stream';

export interface ScanResult {
  infected: boolean;
  viruses: string[];
}

let clamscanInstance: NodeClam | null = null;
let initPromise: Promise<NodeClam> | null = null;

/**
 * Resets the cached NodeClam instance (useful for testing configuration changes).
 */
export function resetAntivirusInstance(): void {
  clamscanInstance = null;
  initPromise = null;
}

/**
 * Lazily initializes and returns the shared NodeClam client instance.
 */
async function getClamscanClient(): Promise<NodeClam> {
  if (clamscanInstance) {
    return clamscanInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  const host = process.env.CLAMAV_HOST;
  const port = process.env.CLAMAV_PORT ? parseInt(process.env.CLAMAV_PORT, 10) : 3310;

  initPromise = (async () => {
    const clamscan = new NodeClam();
    const initialized = await clamscan.init({
      debugMode: false,
      clamdscan: {
        host: host || '127.0.0.1',
        port: isNaN(port) ? 3310 : port,
        timeout: 60000,
        localFallback: false,
        active: true,
        bypassTest: false,
      },
      preference: 'clamdscan',
    });
    clamscanInstance = initialized;
    return initialized;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

/**
 * Scans an in-memory buffer using ClamAV via INSTREAM protocol.
 * If CLAMAV_HOST is not configured:
 *  - When SKIP_ANTIVIRUS_SCAN === 'true', bypasses scan and returns clean.
 *  - Otherwise, throws an explicit configuration error (closed failure).
 */
export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const skipScan = process.env.SKIP_ANTIVIRUS_SCAN === 'true';
  const host = process.env.CLAMAV_HOST;

  if (!host) {
    if (skipScan) {
      return { infected: false, viruses: [] };
    }
    throw new Error('Antivirus no configurado: falta CLAMAV_HOST');
  }

  const client = await getClamscanClient();
  const stream = Readable.from(buffer);

  const result = await client.scanStream(stream);

  return {
    infected: Boolean(result.isInfected),
    viruses: result.viruses || [],
  };
}
