import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { getRGB, getSpectra, listMeasurements, loadDataset, saveAnnotations } from './api';

jest.mock('./api');
jest.mock('./components/HSIViewer', () => (props) => (
  <div data-testid="viewer">
    <span>{props.bands.join(',')}</span>
    <span>{props.idxs.join(',')}</span>
    <span>{props.currentSelections.length} regions</span>
    <button onClick={() => props.onRegion({ shape: { type: 'point', x: 2, y: 3 } })}>Select pixel</button>
    <button onClick={props.onSaveAnnotations}>Save annotations</button>
  </div>
));
jest.mock('./components/SupervisedPanel', () => () => <div>Supervised view</div>);
jest.mock('./components/ImageRegistrationPanel', () => () => <div>Registration view</div>);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  getRGB.mockResolvedValue({ image: 'abcd' });
  getSpectra.mockResolvedValue({ spectra: [0.2, 0.3, 0.4], stddev: [0, 0, 0] });
  saveAnnotations.mockResolvedValue({ saved: true });
});
afterEach(() => jest.restoreAllMocks());

test('queues mixed sensors, loads Specim display bands, saves annotations, and switches to IMEC', async () => {
  listMeasurements.mockResolvedValue([
    { name: 'PE_PS', folder_path: '/data/PE_PS/capture', data_hdr_name: 'PE_PS.hdr', sensor: 'Specim' },
    { name: 'mouse.1', folder_path: '/data/IMEC', data_hdr_name: 'mouse.1.hdr', sensor: 'IMEC' },
  ]);
  loadDataset.mockImplementation(async (source) => source.dataHdrName === 'PE_PS.hdr' ? {
    data_file: 'PE_PS', bands: [935, 1200, 1720], shape: [12, 10, 3],
    sensor: 'Specim', calibration: { status: 'white-dark' }, default_rgb_indices: [2, 1, 0],
    folder_path: '/data/PE_PS/capture', data_hdr_name: 'PE_PS.hdr',
  } : {
    data_file: 'mouse.1', bands: [450, 550, 650, 750, 850], shape: [12, 10, 5],
    sensor: 'IMEC', calibration: { status: 'reflectance' },
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText('Dataset folder path'), { target: { value: '/data' } });
  fireEvent.click(screen.getByRole('button', { name: 'Queue path' }));
  expect(await screen.findByText('2 measurements queued')).toBeInTheDocument();
  expect(listMeasurements).toHaveBeenCalledWith('/data');
  fireEvent.doubleClick(screen.getByRole('button', { name: /PE_PS Specim/ }));
  expect(await screen.findByText('Specim · 12x10x3 · WR/DR calibrated')).toBeInTheDocument();
  expect(screen.getByText('935,1200,1720')).toBeInTheDocument();
  expect(screen.getByText('2,1,0')).toBeInTheDocument();
  await waitFor(() => expect(getRGB).toHaveBeenCalledWith([2, 1, 0], expect.any(Object)));
  fireEvent.click(screen.getByText('Select pixel'));
  await screen.findByText('1 regions');
  fireEvent.click(screen.getByText('Save annotations'));
  await waitFor(() => expect(saveAnnotations).toHaveBeenCalledWith(expect.objectContaining({
    folderPath: '/data/PE_PS/capture', dataHdrName: 'PE_PS.hdr',
    annotations: [expect.objectContaining({ shape: { type: 'point', x: 2, y: 3 } })],
  })));
  fireEvent.doubleClick(screen.getByRole('button', { name: /mouse.1 IMEC/ }));
  expect(await screen.findByText('IMEC · 12x10x5 · Reflectance')).toBeInTheDocument();
  expect(screen.getByText('450,550,650,750,850')).toBeInTheDocument();
  expect(screen.getByText('1,2,3')).toBeInTheDocument();
});

test('preserves calibration opt-outs and reports raw Specim data', async () => {
  listMeasurements.mockResolvedValue([
    { name: 'scene', folder_path: '/data/capture', data_hdr_name: 'scene.hdr', sensor: 'Specim' },
  ]);
  loadDataset.mockResolvedValue({ bands: [1000, 1100, 1200], shape: [12, 10, 3],
    sensor: 'Specim', calibration: { status: 'raw' }, default_display_mode: 'channel',
    warning: 'Calibration reference files ignored by request (WHITEREF); returning raw uncorrected data.' });
  render(<App />);
  fireEvent.click(screen.getByLabelText('Ignore white reference'));
  fireEvent.change(screen.getByLabelText('Dataset folder path'), { target: { value: '/data' } });
  fireEvent.click(screen.getByRole('button', { name: 'Queue path' }));
  fireEvent.doubleClick(await screen.findByRole('button', { name: /scene Specim/ }));
  expect(await screen.findByText(/returning raw uncorrected data/)).toBeInTheDocument();
  expect(loadDataset).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
    ignoreDarkRef: false, ignoreWhiteRef: true,
  }));
  expect(await screen.findByText('Specim · 12x10x3 · Raw')).toBeInTheDocument();
});
