declare module "heic-decode" {
  type DecodedImage = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };
  type DeferredImage = {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  };
  type DeferredImages = DeferredImage[] & { dispose(): void };
  const decode: {
    (input: { buffer: Buffer | Uint8Array }): Promise<DecodedImage>;
    all(input: { buffer: Buffer | Uint8Array }): Promise<DeferredImages>;
  };
  export default decode;
}
