import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, downloadExportFile, encodeUtf8 } from '../js/export-download.js';

class FakeWindow extends EventTarget {
  constructor() {
    super();
    this.btoa = (value) => Buffer.from(value, 'latin1').toString('base64');
    this.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
    this.setTimeout = (callback) => callback();
  }
}

function resultEvent(detail) {
  const event = new Event('android-download-result');
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

test('encodes a large Unicode .su payload as its exact UTF-8 bytes', () => {
  const content = JSON.stringify({ texte: 'Été — 東京 😀 '.repeat(5000) });
  const base64 = bytesToBase64(encodeUtf8(content), (value) => Buffer.from(value, 'latin1').toString('base64'));
  assert.deepEqual(Buffer.from(base64, 'base64'), Buffer.from(content, 'utf8'));
});

test('sends exact Excel bytes to Android and handles started then saved', () => {
  const targetWindow = new FakeWindow();
  const bytes = new Uint8Array([0, 80, 75, 3, 4, 128, 255]);
  const results = [];
  let nativeCall;
  targetWindow.AndroidDownloads = {
    saveFile(...args) {
      nativeCall = args;
      targetWindow.dispatchEvent(resultEvent({ requestId: args[3], status: 'started', fileName: args[0] }));
    },
  };

  const result = downloadExportFile({
    fileName: 'export.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes,
    onAndroidResult: (detail) => results.push(detail.status),
    targetWindow,
    targetDocument: {},
  });
  targetWindow.dispatchEvent(resultEvent({ requestId: result.requestId, status: 'saved', fileName: 'export.xlsx' }));

  assert.equal(nativeCall.length, 4);
  assert.equal(nativeCall[0], 'export.xlsx');
  assert.equal(nativeCall[1], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(Buffer.from(nativeCall[2], 'base64'), Buffer.from(bytes));
  assert.deepEqual(results, ['started', 'saved']);
});

test('keeps concurrent Android results associated with their request', () => {
  const targetWindow = new FakeWindow();
  const calls = [];
  targetWindow.AndroidDownloads = { saveFile: (...args) => calls.push(args) };
  const first = [];
  const second = [];
  downloadExportFile({ fileName: 'a.su', mimeType: 'application/json', bytes: new Uint8Array([1]), onAndroidResult: (d) => first.push(d.status), targetWindow, targetDocument: {} });
  downloadExportFile({ fileName: 'b.su', mimeType: 'application/json', bytes: new Uint8Array([2]), onAndroidResult: (d) => second.push(d.status), targetWindow, targetDocument: {} });
  targetWindow.dispatchEvent(resultEvent({ requestId: calls[1][3], status: 'error', fileName: 'b.su', error: 'disque plein' }));
  targetWindow.dispatchEvent(resultEvent({ requestId: calls[0][3], status: 'saved', fileName: 'a.su' }));
  assert.deepEqual(first, ['saved']);
  assert.deepEqual(second, ['error']);
});

test('uses Blob download only when the Android bridge is absent', () => {
  const targetWindow = new FakeWindow();
  let clicked = false;
  const link = { click: () => { clicked = true; } };
  const targetDocument = {
    createElement: () => link,
    body: { appendChild: () => {}, removeChild: () => {} },
  };
  const result = downloadExportFile({ fileName: 'data.su', mimeType: 'application/json', bytes: encodeUtf8('{}'), targetWindow, targetDocument });
  assert.equal(result.mode, 'browser');
  assert.equal(link.download, 'data.su');
  assert.equal(clicked, true);
});

test('reports a bridge exception as an error without creating a Blob download', () => {
  const targetWindow = new FakeWindow();
  targetWindow.AndroidDownloads = { saveFile: () => { throw new Error('bridge indisponible'); } };
  const results = [];
  const result = downloadExportFile({ fileName: 'data.su', mimeType: 'application/json', bytes: encodeUtf8('{}'), onAndroidResult: (detail) => results.push(detail), targetWindow, targetDocument: { createElement: () => assert.fail('blob fallback') } });
  assert.equal(result.mode, 'android');
  assert.equal(results[0].status, 'error');
  assert.match(results[0].error, /bridge indisponible/);
});
