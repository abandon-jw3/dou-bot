import type { RequiredExecution } from './runtime-config.js';

interface Participant {
  pending(): number;
  step(): boolean;
}
/** Shared admission and fair execution permits. Suspended prompts keep bytes but release a permit. */
export class ExecutionPool {
  private readonly participants: Participant[] = [];
  private waiting = 0;
  private readonly listeners = new Set<() => void>();
  private cursor = 0;
  private active = 0;
  private retainedBytes = 0;
  private pumping = false;
  constructor(private readonly config: RequiredExecution) {}
  register(participant: Participant): () => void {
    this.participants.push(participant);
    return () => {
      const index = this.participants.indexOf(participant);
      if (index >= 0) this.participants.splice(index, 1);
    };
  }
  rejection(bytes: number, prompt: boolean): 'queueFull' | 'bytesFull' | undefined {
    return !prompt &&
      this.waiting + this.active >= this.config.concurrency + this.config.queueCapacity
      ? 'queueFull'
      : this.retainedBytes + bytes > this.config.queueMaxBytes
        ? 'bytesFull'
        : undefined;
  }
  retain(bytes: number): void {
    this.retainedBytes += bytes;
  }
  release(bytes: number): void {
    this.retainedBytes -= bytes;
    this.notify();
  }
  leave(): void {
    this.active--;
  }
  enqueued(): void {
    this.waiting++;
  }
  dequeued(count = 1): void {
    this.waiting -= count;
    this.notify();
  }
  canResume(): boolean {
    return (
      this.waiting <= this.config.queueCapacity / 2 &&
      this.retainedBytes <= this.config.queueMaxBytes / 2
    );
  }
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
  pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiting && this.active < this.config.concurrency) {
        const participants = this.participants;
        let found = false;
        for (let i = 0; i < participants.length; i++) {
          const index = (this.cursor + i) % participants.length;
          const next = participants[index]!;
          if (!next.pending()) continue;
          this.cursor = (index + 1) % participants.length;
          this.active++;
          if (!next.step()) this.active--;
          found = true;
          break;
        }
        if (!found) break;
      }
    } finally {
      this.pumping = false;
    }
  }
  snapshot() {
    return {
      active: this.active,
      pending: this.waiting,
      retainedBytes: this.retainedBytes,
      concurrency: this.config.concurrency,
      queueCapacity: this.config.queueCapacity,
      queueMaxBytes: this.config.queueMaxBytes,
    };
  }
}
