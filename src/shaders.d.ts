/** Type declarations for Bun's file-embed imports of shader sources. */

declare module "*.hlsl" {
  const path: string;
  export default path;
}

declare module "*.hlsli" {
  const path: string;
  export default path;
}

declare module "*.h" {
  const path: string;
  export default path;
}
