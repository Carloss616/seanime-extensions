// `.svg` files are imported as plain text — the build configures
// Bun.build's `text` loader for `.svg`, so the import resolves to the
// raw file contents inlined as a string literal (no asset emitted).
declare module "*.svg" {
  const content: string;
  export default content;
}
