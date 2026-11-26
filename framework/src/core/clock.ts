/** Internal time port. Protocol timestamps use wallTime; durations use monotonic. */
export interface Timer {
  cancel(): void;
  unref(): void;
}

export interface Clock {
  monotonic(): number;
  wallTime(): number;
  timeout(callback: () => void, delayMs: number): Timer;
  interval(callback: () => void, delayMs: number): Timer;
}

function timer(handle: NodeJS.Timeout, cancel: (handle: NodeJS.Timeout) => void): Timer {
  return {
    cancel: () => cancel(handle),
    unref: () => {
      handle.unref();
    },
  };
}

export const systemClock: Clock = Object.freeze({
  monotonic: () => performance.now(),
  wallTime: () => Date.now(),
  timeout: (callback: () => void, delayMs: number) =>
    timer(setTimeout(callback, delayMs), clearTimeout),
  interval: (callback: () => void, delayMs: number) =>
    timer(setInterval(callback, delayMs), clearInterval),
});
