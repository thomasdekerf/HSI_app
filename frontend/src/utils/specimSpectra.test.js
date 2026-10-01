import { exportSpectraCsv, importSpectraCsv } from './export';
import { processSpectrum, SPECTRA_PROCESSING_OPTIONS } from './spectraProcessing';

const bands = Array.from({ length: 224 }, (_, index) => 935.61 + index * (1720.23 - 935.61) / 223);
const spectrum = bands.map((wavelength) => 0.6 - 0.3 * Math.exp(-(((wavelength - 1400) / 100) ** 2)));

test('all spectrum processing modes retain the complete Specim band axis', () => {
  for (const option of SPECTRA_PROCESSING_OPTIONS) {
    const result = processSpectrum(spectrum, { mode: option.id, windowSize: 11, polyOrder: 2 });
    expect(result).toHaveLength(224);
    expect(result.every(Number.isFinite)).toBe(true);
  }
});

test('Specim spectra and standard deviations round-trip through CSV without truncation', () => {
  const originalBlob = global.Blob;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let csv;
  global.Blob = class { constructor(parts) { csv = parts.join(''); } };
  URL.createObjectURL = jest.fn(() => 'blob:test');
  URL.revokeObjectURL = jest.fn();
  try {
    const stddev = bands.map(() => 0.01);
    exportSpectraCsv('PE_PS.csv', bands, [{ label: 'PE region', spectra: spectrum, stddev }]);
    const imported = importSpectraCsv(csv);
    expect(imported).toHaveLength(1);
    expect(imported[0].bands).toEqual(bands);
    expect(imported[0].spectra).toEqual(spectrum);
    expect(imported[0].stddev).toEqual(stddev);
    expect(click).toHaveBeenCalledTimes(1);
  } finally {
    global.Blob = originalBlob;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    click.mockRestore();
  }
});
