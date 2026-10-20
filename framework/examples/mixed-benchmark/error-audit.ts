import type { ErrorContext } from '../../src/index.js';
import { errorOf } from '../../src/core/errors.js';
import type { ErrorReporter } from '../../src/core/logging.js';

/** Benchmark accounting observes the report boundary synchronously. The public onError
 * queue may legitimately run after event completion, when transient entries are gone.
 * The real reporter, redaction, callbacks and their budgets still execute unchanged.
 */
export function auditReports(
  reporter: ErrorReporter,
  audit: (error: Error, context: ErrorContext) => void,
): void {
  const report = reporter.report.bind(reporter);
  reporter.report = (error, context) => {
    audit(errorOf(error), context);
    report(error, context);
  };
}
