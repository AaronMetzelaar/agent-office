export interface SearchHit {
  sessionId: string
  chatId?: string
  title: string
  cwd: string
  at: number
  snippet: [string, string, string]
}
