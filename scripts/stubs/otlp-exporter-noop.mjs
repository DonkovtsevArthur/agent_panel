/**
 * Harbor stub for OTLP HTTP exporters — blocks accidental OpenTelemetry export.
 */
export class OTLPTraceExporter {
  constructor(_options) {}
  export(_spans, resultCallback) {
    if (typeof resultCallback === "function") {
      resultCallback({ code: 0 });
    }
  }
  shutdown() {
    return Promise.resolve();
  }
}

export class OTLPMetricExporter {
  constructor(_options) {}
  export(_metrics, resultCallback) {
    if (typeof resultCallback === "function") {
      resultCallback({ code: 0 });
    }
  }
  shutdown() {
    return Promise.resolve();
  }
}

export class OTLPLogExporter {
  constructor(_options) {}
  export(_logs, resultCallback) {
    if (typeof resultCallback === "function") {
      resultCallback({ code: 0 });
    }
  }
  shutdown() {
    return Promise.resolve();
  }
}

export default {
  OTLPTraceExporter,
  OTLPMetricExporter,
  OTLPLogExporter,
};
