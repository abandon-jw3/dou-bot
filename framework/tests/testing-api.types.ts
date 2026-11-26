import * as runtime from '../src/testing/index.js';
import type * as Contract from '../docs/testing-api.js';

const publicApi: typeof Contract = runtime;
void publicApi;

function inspectAdmission(result: runtime.TestAdmission, harness: runtime.TestHarness): void {
  const compatible: Contract.TestHarness = harness;
  void compatible;
  if ('done' in result) {
    const status: 'accepted' | 'duplicate' = result.status;
    const completion: Promise<void> = result.done;
    void status;
    completion.catch(() => {});
  } else {
    const status: 'ignored' | 'overloaded' | 'stopping' | 'failed' = result.status;
    void status;
    // @ts-expect-error Rejected or ignored input has no workflow completion promise.
    void result.done;
  }
  // @ts-expect-error Capture arrays cannot be appended to through the public harness.
  harness.errors[0] = { error: new Error('test'), context: { phase: 'command', appId: 'test' } };
}
void inspectAdmission;

// @ts-expect-error Accepted events must expose their completion promise.
const incomplete: runtime.TestAdmission = { status: 'accepted' };
void incomplete;
