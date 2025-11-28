import { createHash, createSign, createVerify, generateKeyPair as cryptoGenerateKeyPair } from 'node:crypto';

/**
 * Generate a new key pair for testing/development
 * In production, this should use proper key management
 */
export function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  return new Promise((resolve, reject) => {
    cryptoGenerateKeyPair('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    }, (err, publicKey, privateKey) => {
      if (err) {
        reject(err);
      } else {
        resolve({ publicKey, privateKey });
      }
    });
  });
}

/**
 * Sign data with a private key
 */
export function sign(data: string, privateKey: string): string {
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  return sign.sign(privateKey, 'base64');
}

/**
 * Verify a signature
 */
export function verify(data: string, signature: string, publicKey: string): boolean {
  try {
    const verify = createVerify('RSA-SHA256');
    verify.update(data);
    return verify.verify(publicKey, signature, 'base64');
  } catch (error) {
    return false;
  }
}

/**
 * Hash data using SHA-256
 */
export function hash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a random transaction ID
 */
export function generateTxId(): string {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2);
  return hash(timestamp + random);
}

/**
 * Serialize an object to a canonical string for signing
 */
export function canonicalStringify(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}