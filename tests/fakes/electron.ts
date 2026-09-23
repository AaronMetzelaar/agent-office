const scramble = (bytes: Uint8Array) => Buffer.from(bytes.map((byte) => byte ^ 0x5a))

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => scramble(Buffer.from(`enc:${text}`)),
  decryptString: (bytes: Buffer) => scramble(bytes).toString().replace(/^enc:/, ''),
}
