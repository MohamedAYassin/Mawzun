// Minimal Prometheus Remote Write encoder (WriteRequest protobuf) +
// snappy block compression — the wire format Grafana Cloud Mimir requires.
//
// protobufjs fromJSON with the prompb/remote.proto subset:
// WriteRequest { repeated TimeSeries timeseries = 1; }
// TimeSeries   { repeated Label labels = 1; repeated Sample samples = 2; }
// Label        { string name = 1; string value = 2; }
// Sample       { double value = 1; int64 timestamp_ms = 2; }
import snappy from "snappyjs";
import { createRequire } from "node:module";
const requireCjs = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const protobuf = requireCjs("protobufjs") as any;

const root = protobuf.Root.fromJSON({
  nested: {
    prometheus: {
      nested: {
        Label: { fields: { name: { type: "string", id: 1 }, value: { type: "string", id: 2 } } },
        Sample: { fields: { value: { type: "double", id: 1 }, timestampMs: { type: "int64", id: 2 } } },
        TimeSeries: {
          fields: {
            labels: { rule: "repeated", type: "Label", id: 1 },
            samples: { rule: "repeated", type: "Sample", id: 2 },
          },
        },
        WriteRequest: { fields: { timeseries: { rule: "repeated", type: "TimeSeries", id: 1 } } },
      },
    },
  },
});

const WriteRequest = root.lookupType("prometheus.WriteRequest");

export interface RemoteWriteSeries {
  labels: Record<string, string>;
  value: number;
  timestampMs: number;
}

/**
 * Encodes series into a snappy-compressed Prometheus WriteRequest —
 * the body format for POST /api/prom/push on Grafana Cloud Mimir.
 */
export function encodeRemoteWrite(series: RemoteWriteSeries[]): Uint8Array {
  const request = WriteRequest.fromObject({
    timeseries: series.map((s) => ({
      labels: Object.entries(s.labels).map(([name, value]) => ({ name, value })),
      samples: [{ value: s.value, timestampMs: s.timestampMs }],
    })),
  });
  const encoded = WriteRequest.encode(request).finish();
  return snappy.compress(encoded);
}
