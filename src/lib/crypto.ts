import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from 'crypto';

export interface GeneratedKeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateKeyPair(): GeneratedKeyPair {
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);

  return {
    publicKey: Buffer.from(publicKey).toString('base64'),
    privateKey: Buffer.from(privateKey).toString('base64'),
  };
}

export function privateKeyFromBase64(base64Key: string): Uint8Array {
  return Buffer.from(base64Key, 'base64');
}

export function publicKeyFromPrivateKey(privateKeyBase64: string): string {
  const privateKey = privateKeyFromBase64(privateKeyBase64);
  const publicKey = ed25519.getPublicKey(privateKey);
  return Buffer.from(publicKey).toString('base64');
}

export function sign(message: string, privateKeyBase64: string): string {
  const privateKey = privateKeyFromBase64(privateKeyBase64);
  const messageBytes = new TextEncoder().encode(message);
  const signature = ed25519.sign(messageBytes, privateKey);
  return Buffer.from(signature).toString('base64url');
}

export function verify(message: string, signatureBase64: string, publicKeyBase64: string): boolean {
  const publicKey = Buffer.from(publicKeyBase64, 'base64');
  const signature = Buffer.from(signatureBase64, 'base64');
  const messageBytes = new TextEncoder().encode(message);
  return ed25519.verify(signature, messageBytes, publicKey);
}
