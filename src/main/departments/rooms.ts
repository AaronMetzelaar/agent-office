import { applyRooms, repoPath, roomIds, ruleFor, type DeptRule, type Room } from '../../shared/departments'

export type Rooms = ReturnType<typeof createRooms>
type Ask = (accountId: string, system: string, prompt: string) => Promise<string | undefined>

const key = 'rooms'
const namePrompt = 'A coding agent is starting on the task below, in the folder below. None of the office rooms fit it, so it gets a new room. On the first line, name the room in 1 to 3 words, like a team or project name. On the second line, say in one sentence what work belongs in this room. Reply with the two lines only.'
const clean = (line: string) => line.replace(/^["'`*#\s]+|["'`*.\s]+$/g, '')
const isRoom = (value: unknown): value is Room => roomIds.includes((value as Room)?.id) && typeof (value as Room).name === 'string' && typeof (value as Room).about === 'string'

export function createRooms(settings: { setting(key: string): unknown; saveSetting(key: string, value: unknown): void }, ask: Ask, changed: (rooms: readonly Room[]) => void) {
  const saved = settings.setting(key)
  const rooms: Room[] = Array.isArray(saved) ? saved.filter(isRoom) : []
  const making = new Map<string, Promise<Room | undefined>>()
  const free = () => roomIds.find((id) => !rooms.some((room) => room.id === id))
  applyRooms(rooms)

  async function name(accountId: string, root: string, task: string, rules: readonly DeptRule[]): Promise<Room | undefined> {
    if (!free()) return undefined
    const [title, about] = ((await ask(accountId, namePrompt, `Folder: ${root}\n\nTask: ${task.slice(0, 4000)}`)) ?? '').split('\n').map(clean).filter(Boolean)
    const id = free()
    if (!title || !id) return undefined
    const room: Room = { id, name: title.slice(0, 28), about: about ?? title, ...(ruleFor(root, rules) ? {} : { folder: root }) }
    rooms.push(room)
    settings.saveSetting(key, rooms)
    applyRooms([room])
    changed(rooms)
    return room
  }

  return {
    list: (): readonly Room[] => rooms,
    full: () => !free(),
    make(accountId: string, cwd: string, task: string, rules: readonly DeptRule[]): Promise<Room | undefined> {
      const root = repoPath(cwd)
      const known = rooms.find((room) => room.folder === root)
      if (known) return Promise.resolve(known)
      const pending = making.get(root) ?? name(accountId, root, task, rules).finally(() => making.delete(root))
      making.set(root, pending)
      return pending
    },
  }
}
