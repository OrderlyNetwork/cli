/* tslint:disable */
/* eslint-disable */

/**
 * Build the Orderly auth headers for a pre-computed signature.
 */
export function headers(account_id: string, public_key_base64: string, signature: string, timestamp: number): any;

/**
 * The exact message covered by an Orderly signature.
 */
export function message(timestamp: number, method: string, path: string, body?: string | null): string;

/**
 * Build a request without signing it.
 *
 * `params` is a JavaScript object. `body` is returned as the exact JSON string
 * the signer must cover, preserving key order.
 */
export function prepare(kind: string, params: any): any;

/**
 * Convert a standard-base64 public key to the base58 header form.
 */
export function public_key_base58(public_key_base64: string): string;

/**
 * Derive the standard-base64 public key from a base64 seed.
 */
export function public_key_from_private_key(private_key_base64: string): string;

/**
 * Sign a message with a base64 Ed25519 seed. Returns base64url without padding.
 */
export function sign(message: string, private_key_base64: string): string;

/**
 * Sign headers locally, used by the memory signer.
 */
export function sign_headers(account_id: string, public_key_base64: string, private_key_base64: string, timestamp: number, method: string, path: string, body?: string | null): any;

/**
 * Verify a base64url signature against a standard-base64 public key.
 */
export function verify(message: string, signature_base64url: string, public_key_base64: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly headers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly message: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly prepare: (a: number, b: number, c: any) => [number, number, number];
    readonly public_key_base58: (a: number, b: number) => [number, number];
    readonly public_key_from_private_key: (a: number, b: number) => [number, number];
    readonly sign: (a: number, b: number, c: number, d: number) => [number, number];
    readonly sign_headers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
    readonly verify: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
