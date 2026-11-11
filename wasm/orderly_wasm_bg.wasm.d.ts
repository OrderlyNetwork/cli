/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const headers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
export const message: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
export const prepare: (a: number, b: number, c: any) => [number, number, number];
export const public_key_base58: (a: number, b: number) => [number, number];
export const public_key_from_private_key: (a: number, b: number) => [number, number];
export const sign: (a: number, b: number, c: number, d: number) => [number, number];
export const sign_headers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
export const verify: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_start: () => void;
