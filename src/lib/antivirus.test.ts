import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanBuffer, resetAntivirusInstance } from './antivirus';

const mockScanStream = vi.fn();
const mockInit = vi.fn();

vi.mock('clamscan', () => {
  return {
    default: class MockNodeClam {
      init = mockInit;
      scanStream = mockScanStream;
    },
  };
});

describe('Antivirus service: scanBuffer', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAntivirusInstance();
    process.env = { ...originalEnv };
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
    delete process.env.SKIP_ANTIVIRUS_SCAN;

    mockInit.mockImplementation(async function (this: unknown) {
      return this;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    resetAntivirusInstance();
  });

  it('lanza error explícito cuando CLAMAV_HOST no está configurado y SKIP_ANTIVIRUS_SCAN no es true (falla cerrada)', async () => {
    const dummyBuffer = Buffer.from('hello world');
    await expect(scanBuffer(dummyBuffer)).rejects.toThrow('Antivirus no configurado: falta CLAMAV_HOST');
  });

  it('devuelve limpio sin escanear cuando SKIP_ANTIVIRUS_SCAN="true" en ausencia de CLAMAV_HOST', async () => {
    process.env.SKIP_ANTIVIRUS_SCAN = 'true';
    const dummyBuffer = Buffer.from('hello world');
    const result = await scanBuffer(dummyBuffer);

    expect(result).toEqual({ infected: false, viruses: [] });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockScanStream).not.toHaveBeenCalled();
  });

  it('detecta un archivo limpio cuando ClamAV responde isInfected: false', async () => {
    process.env.CLAMAV_HOST = 'clamav.internal';
    process.env.CLAMAV_PORT = '3310';

    mockScanStream.mockResolvedValueOnce({
      isInfected: false,
      viruses: [],
    });

    const cleanBuffer = Buffer.from('%PDF-1.4 clean pdf content');
    const result = await scanBuffer(cleanBuffer);

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        clamdscan: expect.objectContaining({
          host: 'clamav.internal',
          port: 3310,
        }),
      }),
    );
    expect(mockScanStream).toHaveBeenCalled();
    expect(result).toEqual({ infected: false, viruses: [] });
  });

  it('detecta un archivo infectado (ej. EICAR test string) cuando ClamAV responde isInfected: true', async () => {
    process.env.CLAMAV_HOST = 'clamav.internal';

    mockScanStream.mockResolvedValueOnce({
      isInfected: true,
      viruses: ['Eicar-Test-Signature'],
    });

    // Standard EICAR test string
    const eicarBuffer = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    );
    const result = await scanBuffer(eicarBuffer);

    expect(result).toEqual({
      infected: true,
      viruses: ['Eicar-Test-Signature'],
    });
  });
});
