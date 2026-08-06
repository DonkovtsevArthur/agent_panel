/**
 * Harbor stub for @langfuse/otel — no network exporters.
 */
export class LangfuseSpanProcessor {
  constructor(_options) {}
  forceFlush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
  onStart() {}
  onEnd() {}
}

export default { LangfuseSpanProcessor };
