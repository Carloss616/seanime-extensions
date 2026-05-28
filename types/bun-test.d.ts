// Minimal `bun:test` ambient module declaration.
//
// We avoid pulling in the full `@types/bun` (which is in devDependencies for
// scripts/) because it redeclares `fetch` with the web-standard signature,
// conflicting with the goja-tailored `fetch` declared in types/core.d.ts.
// `bun:test` is the only thing the test files need from Bun's surface, so
// declare just that here and keep `compilerOptions.types: []` in tsconfig.

declare module "bun:test" {
  // expect's matcher surface is large and version-dependent; returning `any`
  // here keeps the tests usable without modelling Bun's full Jest-like API.
  export function expect(actual: unknown): any;
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(
    name: string,
    fn: () => unknown | Promise<unknown>,
  ): void;
  export const it: typeof test;
  export function beforeAll(fn: () => unknown | Promise<unknown>): void;
  export function beforeEach(fn: () => unknown | Promise<unknown>): void;
  export function afterAll(fn: () => unknown | Promise<unknown>): void;
  export function afterEach(fn: () => unknown | Promise<unknown>): void;
}
