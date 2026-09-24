const scramble = (bytes: Uint8Array) => Buffer.from(bytes.map((byte) => byte ^ 0x5a))

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => scramble(Buffer.from(`enc:${text}`)),
  decryptString: (bytes: Buffer) => scramble(bytes).toString().replace(/^enc:/, ''),
}

export const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
export const ipcMain = { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(name, handler) }
