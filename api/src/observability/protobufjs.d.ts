declare module "protobufjs" {
  // Minimal surface used by remoteWrite.ts. protobufjs ships its own types,
  // but the fromJSON static is exposed on the Root constructor in a way TS
  // resolves awkwardly under moduleResolution: bundler; declare the narrow
  // shape we rely on.
  export const protobuf: {
    fromJSON: (json: unknown) => {
      lookupType: (name: string) => {
        fromObject: (obj: unknown) => unknown;
        encode: (msg: unknown) => { finish: () => Uint8Array };
      };
    };
  };
}
