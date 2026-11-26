import type { RequestListener } from 'node:http';
export interface Transport {
  start(): Promise<void>;
  stop(deadline: number): Promise<void>;
  handler?: RequestListener;
}
