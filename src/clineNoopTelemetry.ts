/**
 * Harbor no-op Cline telemetry.
 * Keeps ClineCore from ever shipping events; avoids wiring PostHog/OTEL adapters.
 * Shape matches @cline/shared ITelemetryService without importing that package.
 */

export type HarborTelemetryProperties = {
  [key: string]: unknown;
};

export type HarborNoopTelemetry = {
  setDistinctId(distinctId?: string): void;
  setMetadata(metadata: Record<string, unknown>): void;
  updateMetadata(metadata: Record<string, unknown>): void;
  setCommonProperties(properties: HarborTelemetryProperties): void;
  updateCommonProperties(properties: HarborTelemetryProperties): void;
  isEnabled(): boolean;
  capture(input: { event: string; properties?: HarborTelemetryProperties }): void;
  captureRequired(event: string, properties?: HarborTelemetryProperties): void;
  recordCounter(
    name: string,
    value: number,
    attributes?: HarborTelemetryProperties,
    description?: string,
    required?: boolean
  ): void;
  recordHistogram(
    name: string,
    value: number,
    attributes?: HarborTelemetryProperties,
    description?: string,
    required?: boolean
  ): void;
  recordGauge(
    name: string,
    value: number | null,
    attributes?: HarborTelemetryProperties,
    description?: string,
    required?: boolean
  ): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
};

/** Stable id so Cline does not persist a machine-id under ~/.cline. */
export const HARBOR_CLINE_DISTINCT_ID = "harbor-agents";

export function createHarborNoopTelemetry(): HarborNoopTelemetry {
  return {
    setDistinctId() {},
    setMetadata() {},
    updateMetadata() {},
    setCommonProperties() {},
    updateCommonProperties() {},
    isEnabled() {
      return false;
    },
    capture() {},
    captureRequired() {},
    recordCounter() {},
    recordHistogram() {},
    recordGauge() {},
    async flush() {},
    async dispose() {},
  };
}
