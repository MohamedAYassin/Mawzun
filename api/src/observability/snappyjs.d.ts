// Narrow ambient declaration: only the surface remoteWrite.ts uses.
//
// snappyjs ships no types. Declaring just `compress` keeps this file honest —
// a wider declaration would type-check calls to functions this project has
// never verified, and `decompress` in particular is unused here (nothing in
// this codebase reads a snappy payload; we only produce them).
declare module "snappyjs" {
  export function compress(input: Uint8Array | Buffer): Uint8Array;
}
