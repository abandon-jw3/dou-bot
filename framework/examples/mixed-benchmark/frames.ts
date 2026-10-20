import assert from 'node:assert/strict';
import type { Readable, Writable } from 'node:stream';
import { record } from './common.js';
import type { Message } from './worker.js';

const FRAME_LIMIT = 65536;
const PENDING_LIMIT = 1048576;

/** Never buffer reports or an unbounded control stream over SSH. Reports travel as files. */
export function sendFrame(stream: Writable, message: Message): void {
  const line = JSON.stringify(message) + '\n';
  assert.ok(Buffer.byteLength(line) <= FRAME_LIMIT, 'Benchmark control frame too large');
  assert.ok(
    stream.writableLength <= PENDING_LIMIT,
    'Benchmark control channel backpressure exceeded',
  );
  stream.write(line);
}

export function receiveFrames(
  stream: Readable,
  receive: (message: Message) => void,
  failure: (error: Error) => void,
): () => void {
  let pending = Buffer.alloc(0);
  let failed = false;
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    pending = Buffer.alloc(0);
    failure(error instanceof Error ? error : new Error(String(error)));
  };
  const data = (input: Buffer | string) => {
    if (failed) return;
    try {
      const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        assert.ok(pending.length + end - offset < FRAME_LIMIT, 'Benchmark control frame too large');
        const part = chunk.subarray(offset, end);
        const bytes = pending.length ? Buffer.concat([pending, part]) : part;
        if (newline < 0) {
          pending = Buffer.from(bytes);
          break;
        }
        pending = Buffer.alloc(0);
        if (bytes.length) {
          const message: unknown = JSON.parse(bytes.toString('utf8'));
          assert.ok(record(message), 'Invalid benchmark control frame');
          receive(message);
        }
        offset = newline + 1;
      }
    } catch (error) {
      fail(error);
    }
  };
  const end = () => {
    if (pending.length) fail(new Error('Truncated benchmark control frame'));
  };
  stream.on('data', data);
  stream.once('end', end);
  stream.once('error', fail);
  return () => {
    stream.off('data', data);
    stream.off('end', end);
    stream.off('error', fail);
    pending = Buffer.alloc(0);
  };
}
