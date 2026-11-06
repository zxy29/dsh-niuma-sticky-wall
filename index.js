/**
 * Sticky Wall — Host half.
 *
 * Owns the one durable note list (`$DSH_HOME/sticky-notes.json`, kept at that
 * path so existing data survives the renames), the `/api/sticky-notes/notes`
 * route family the sidebar page calls, and the `task_records` agent tool. The
 * page and the agent therefore always read and write the same list.
 *
 * Every note carries a local calendar day (`YYYY-MM-DD`) and one paper color.
 * Notes written before those features fall back to the day they were created
 * and the default color.
 *
 * The route family is fenced to the local GUI: the socket peer must be
 * loopback and a browser cross-origin caller is rejected, so a LAN-exposed DSH
 * host never serves the records to anyone else.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Host plugin name (the bundle patch row id is `sticky-notes`). */
export const name = 'sticky-notes'

/** The web server must be listening before the route family can register. */
export const inject = ['webServer']

/** Exact route the browser half fetches, same origin as the page. */
const API_PATH = '/api/sticky-notes/notes'

/** On-disk format version of the note file (2 adds the per-record date). */
const STORE_VERSION = 2

/** Upper bounds: one note body and the whole list. */
const MAX_TEXT = 4000
const MAX_NOTES = 500

/** Request body cap (notes are text only). */
const MAX_BODY_BYTES = 64 * 1024

/** Card colors a record may carry, in the page's swatch order. */
const COLORS = ['amber', 'rose', 'sky', 'sage', 'violet', 'sand']

/** Color of a record that carries none (records written before colors). */
const DEFAULT_COLOR = 'amber'

// ---------------------------------------------------------------- storage

/** Expand a leading `~` against the platform home directory. */
function expandHome(path, home) {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/**
 * Resolve the DSH home directory: the `DSH_HOME` environment override wins,
 * the platform home fallback (`~/.dsh`) follows.
 * @returns {string} absolute directory the note file lives in.
 */
function dshHome() {
  const home = homedir()
  const raw = process.env.DSH_HOME
  if (typeof raw === 'string' && raw.trim() !== '') {
    const expanded = expandHome(raw.trim(), home)
    return expanded
  }
  return join(home, '.dsh')
}

/** One stored note, defensively copied so callers cannot mutate the store. */
function copyNote(note) {
  return {
    id: note.id,
    text: note.text,
    done: note.done,
    date: note.date,
    color: note.color,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

/** Normalize one note loaded from disk; undefined drops a malformed record. */
function normalizeNote(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  if (typeof raw.id !== 'string' || raw.id === '') return undefined
  if (typeof raw.text !== 'string') return undefined
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
  // Records written before the date feature (and hand-edited files) fall back
  // to the day the record was created, so no note ever loses its placement.
  const date = cleanDate(raw.date) ?? localDateKey(createdAt)
  return {
    id: raw.id,
    text: raw.text,
    done: raw.done === true,
    date,
    color: cleanColor(raw.color) ?? DEFAULT_COLOR,
    createdAt,
    updatedAt,
  }
}

/** Read a whole note file body into a note array; a foreign shape reads as empty. */
function normalizeFile(parsed) {
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.notes)) return []
  const notes = []
  for (const raw of parsed.notes) {
    const note = normalizeNote(raw)
    if (note !== undefined) notes.push(note)
  }
  return notes.slice(-MAX_NOTES)
}

/**
 * Trim and bound one submitted note body.
 * @param {unknown} value - raw request payload field.
 * @returns {string | undefined} the accepted text, or undefined to reject.
 */
function cleanText(value) {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\r\n/g, '\n').trim()
  if (text === '') return undefined
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
}

/** Local calendar day of one instant, as `YYYY-MM-DD`. */
function localDateKey(instant) {
  const date = new Date(instant)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

/**
 * Validate one calendar day in `YYYY-MM-DD` form.
 * @param {unknown} value - raw payload field.
 * @returns {string | undefined} the normalized day, or undefined to reject.
 */
function cleanDate(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return undefined
  return match[1] + '-' + match[2] + '-' + match[3]
}

/**
 * Validate one card color id.
 * @param {unknown} value - raw payload field.
 * @returns {string | undefined} the accepted palette id, or undefined to reject.
 */
function cleanColor(value) {
  if (typeof value !== 'string') return undefined
  return COLORS.includes(value) ? value : undefined
}

/**
 * Durable note list backed by one JSON file. Writes are serialized and
 * atomic (temp file + rename), so a crash never leaves a half-written file.
 */
class NoteStore {
  /** @param {string} file - absolute path of the JSON file. */
  constructor(file) {
    this.file = file
    this.loaded = false
    this.notes = []
    this.writing = Promise.resolve()
  }

  /** Load the file once; a missing or unreadable file reads as an empty list. */
  async ensureLoaded() {
    if (this.loaded) return
    try {
      const raw = await readFile(this.file, 'utf8')
      this.notes = normalizeFile(JSON.parse(raw))
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') {
        console.warn('[sticky-notes] could not read', this.file, error)
      }
      this.notes = []
    }
    this.loaded = true
  }

  /** @returns {Array<object>} every note, in creation order. */
  list() {
    return this.notes.map(copyNote)
  }

  /**
   * Append one note.
   * @param {string} text - accepted text body.
   * @param {string | undefined} date - accepted calendar day, or undefined for today.
   * @param {string | undefined} color - accepted palette id, or undefined for the default.
   * @returns {Promise<object>} the created note.
   */
  async add(text, date, color) {
    await this.ensureLoaded()
    const now = Date.now()
    const note = {
      id: randomUUID(),
      text,
      done: false,
      date: date === undefined ? localDateKey(now) : date,
      color: color === undefined ? DEFAULT_COLOR : color,
      createdAt: now,
      updatedAt: now,
    }
    const next = this.notes.concat([note])
    this.notes = next.length > MAX_NOTES ? next.slice(next.length - MAX_NOTES) : next
    await this.persist()
    return copyNote(note)
  }

  /**
   * Apply one patch to one note.
   * @param {string} id - note id.
   * @param {{ text?: string, done?: boolean, date?: string, color?: string }} patch - accepted fields.
   * @returns {Promise<object | undefined>} the updated note, or undefined when absent.
   */
  async update(id, patch) {
    await this.ensureLoaded()
    const note = this.notes.find((entry) => entry.id === id)
    if (note === undefined) return undefined
    if (typeof patch.text === 'string') note.text = patch.text
    if (typeof patch.done === 'boolean') note.done = patch.done
    if (typeof patch.date === 'string') note.date = patch.date
    if (typeof patch.color === 'string') note.color = patch.color
    note.updatedAt = Date.now()
    await this.persist()
    return copyNote(note)
  }

  /**
   * Delete one note.
   * @param {string} id - note id.
   * @returns {Promise<boolean>} whether a note was removed.
   */
  async remove(id) {
    await this.ensureLoaded()
    const before = this.notes.length
    this.notes = this.notes.filter((entry) => entry.id !== id)
    if (this.notes.length === before) return false
    await this.persist()
    return true
  }

  /** Write the current list atomically; writes queue behind each other. */
  persist() {
    const snapshot = JSON.stringify({ version: STORE_VERSION, notes: this.notes }, null, 2)
    const run = async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = this.file + '.tmp'
      await writeFile(temporary, snapshot, { mode: 0o600 })
      await rename(temporary, this.file)
    }
    this.writing = this.writing.then(run, run)
    return this.writing
  }
}

// ------------------------------------------------------------- transport

/** Write one JSON response. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(payload)
}

/** IPv4 127/8 predicate. */
function isIPv4Loopback(value) {
  const parts = value.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Whether a socket peer address is on the loopback range. */
function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7))
  return isIPv4Loopback(normalized)
}

/** Whether a normalized URL hostname names this machine. */
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/**
 * Request fence: the peer must be loopback and the request must look like a
 * same-origin call from the local GUI (a cross-origin browser caller is
 * rejected). X-Forwarded-For is never trusted.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {boolean} whether the request may touch the note list.
 */
function isTrustedRequest(req) {
  if (req.socket === undefined || !isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostname
  try {
    hostname = new URL('http://' + host).hostname
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostname)) return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === 'null') return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Read a bounded JSON body.
 * @returns {Promise<unknown | null>} the parsed body, `null` for invalid JSON.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      req.destroy()
      return null
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Narrow a payload to a plain JSON object. */
function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

// --------------------------------------------------------------- agent tool

/** Render the note list for the agent tool. */
function renderNotes(notes) {
  if (notes.length === 0) return 'The sticky wall is empty.'
  const lines = notes.map((note) => `- [${note.done ? 'x' : ' '}] ${note.date} ${note.color} ${note.text}  (id: ${note.id})`)
  const pending = notes.filter((note) => !note.done).length
  return `Sticky wall — ${pending} open, ${notes.length - pending} done:\n` + lines.join('\n')
}

/** The one record schema shared by the tool output and the page payload. */
const NOTE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Stable record id.' },
    text: { type: 'string', description: 'Record text.' },
    done: { type: 'boolean', description: 'Whether the record is checked off.' },
    date: { type: 'string', description: 'Calendar day of the record, YYYY-MM-DD.' },
    color: { type: 'string', enum: COLORS, description: 'Card color id of the record.' },
    createdAt: { type: 'integer', description: 'Creation time (epoch ms).' },
    updatedAt: { type: 'integer', description: 'Last change time (epoch ms).' },
  },
  required: ['id', 'text', 'done', 'date', 'color', 'createdAt', 'updatedAt'],
}

/**
 * Build the `task_records` tool over the same store the page uses.
 * @param {NoteStore} store - the plugin's record store.
 * @returns {object} a ToolDefinition.
 */
function makeTaskRecordsTool(store) {
  return {
    name: 'task_records',
    description: "Read and edit the user's Sticky Wall panel (a wall of colored sticky notes in the DSH sidebar, one date and one color per note). action=list returns every note; action=add creates one from `text` (with optional `date` and `color`); action=update changes the note `id` (new `text`, `date`, `color`, and/or `done`); action=remove deletes the note `id`. When the user asks to jot down, remember, or note a sudden task, add it; when they ask what is on today's wall or on some day's wall, list it and filter by `date`.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'update', 'remove'],
          description: 'Operation to perform.',
        },
        text: {
          type: 'string',
          description: 'Record text. Required for add; optional new text for update.',
        },
        date: {
          type: 'string',
          description: 'Calendar day in YYYY-MM-DD form. Optional for add (defaults to today); optional new day for update.',
        },
        color: {
          type: 'string',
          enum: COLORS,
          description: 'Card color id. Optional for add (defaults to amber); optional new color for update.',
        },
        id: {
          type: 'string',
          description: 'Record id from a previous list/add result. Required for update and remove.',
        },
        done: {
          type: 'boolean',
          description: 'With action=update: true checks the record off, false reopens it.',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          notes: { type: 'array', items: NOTE_VALUE_SCHEMA, description: 'The full note list after the operation.' },
        },
        required: ['notes'],
      },
      render: (_args, value) => [
        { type: 'text', text: renderNotes(value !== null && typeof value === 'object' && Array.isArray(value.notes) ? value.notes : []) },
      ],
    },
    async execute(args) {
      const input = asObject(args) === undefined ? {} : args
      const action = typeof input.action === 'string' ? input.action : ''
      if (action === 'add') {
        const text = cleanText(input.text)
        if (text === undefined) throw new Error('text is required for action=add')
        let date
        if (input.date !== undefined) {
          date = cleanDate(input.date)
          if (date === undefined) throw new Error('date must be a real calendar day in YYYY-MM-DD form')
        }
        let color
        if (input.color !== undefined) {
          color = cleanColor(input.color)
          if (color === undefined) throw new Error('color must be one of: ' + COLORS.join(', '))
        }
        await store.add(text, date, color)
        return { notes: store.list() }
      }
      if (action === 'update') {
        const id = typeof input.id === 'string' ? input.id : ''
        if (id === '') throw new Error('id is required for action=update')
        const patch = {}
        if (input.text !== undefined) {
          const text = cleanText(input.text)
          if (text === undefined) throw new Error('text must be non-empty when given')
          patch.text = text
        }
        if (input.done !== undefined) {
          if (typeof input.done !== 'boolean') throw new Error('done must be a boolean')
          patch.done = input.done
        }
        if (input.date !== undefined) {
          const date = cleanDate(input.date)
          if (date === undefined) throw new Error('date must be a real calendar day in YYYY-MM-DD form')
          patch.date = date
        }
        if (input.color !== undefined) {
          const color = cleanColor(input.color)
          if (color === undefined) throw new Error('color must be one of: ' + COLORS.join(', '))
          patch.color = color
        }
        if (Object.keys(patch).length === 0) throw new Error('action=update needs text, date, color, and/or done')
        const updated = await store.update(id, patch)
        if (updated === undefined) throw new Error(`no note with id ${id}`)
        return { notes: store.list() }
      }
      if (action === 'remove') {
        const id = typeof input.id === 'string' ? input.id : ''
        if (id === '') throw new Error('id is required for action=remove')
        const removed = await store.remove(id)
        if (!removed) throw new Error(`no note with id ${id}`)
        return { notes: store.list() }
      }
      if (action !== 'list') throw new Error(`unknown action: ${action}`)
      await store.ensureLoaded()
      return { notes: store.list() }
    },
  }
}

// ------------------------------------------------------------------ plugin

/**
 * Mount the record store, its route family, and the agent tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  const store = new NoteStore(join(dshHome(), 'sticky-notes.json'))

  /** One handler per path; the web server rejects duplicate (kind, path) rows. */
  const handler = async (req, res) => {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden: local GUI only' })
      return
    }
    const method = typeof req.method === 'string' ? req.method : 'GET'
    const url = new URL(req.url ?? API_PATH, 'http://127.0.0.1')
    try {
      if (method === 'GET') {
        await store.ensureLoaded()
        sendJson(res, 200, { notes: store.list() })
        return
      }
      if (method === 'POST') {
        const body = asObject(await readJsonBody(req))
        if (body === undefined) {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const text = cleanText(body.text)
        if (text === undefined) {
          sendJson(res, 400, { error: 'text is required' })
          return
        }
        let date
        if (body.date !== undefined) {
          date = cleanDate(body.date)
          if (date === undefined) {
            sendJson(res, 400, { error: 'date must be a real calendar day in YYYY-MM-DD form' })
            return
          }
        }
        let color
        if (body.color !== undefined) {
          color = cleanColor(body.color)
          if (color === undefined) {
            sendJson(res, 400, { error: 'color must be one of: ' + COLORS.join(', ') })
            return
          }
        }
        sendJson(res, 201, { note: await store.add(text, date, color) })
        return
      }
      if (method === 'PATCH') {
        const body = asObject(await readJsonBody(req))
        if (body === undefined) {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const id = typeof body.id === 'string' ? body.id : ''
        if (id === '') {
          sendJson(res, 400, { error: 'id is required' })
          return
        }
        const patch = {}
        if (body.text !== undefined) {
          const text = cleanText(body.text)
          if (text === undefined) {
            sendJson(res, 400, { error: 'text must be non-empty when given' })
            return
          }
          patch.text = text
        }
        if (body.done !== undefined) {
          if (typeof body.done !== 'boolean') {
            sendJson(res, 400, { error: 'done must be a boolean' })
            return
          }
          patch.done = body.done
        }
        if (body.date !== undefined) {
          const date = cleanDate(body.date)
          if (date === undefined) {
            sendJson(res, 400, { error: 'date must be a real calendar day in YYYY-MM-DD form' })
            return
          }
          patch.date = date
        }
        if (body.color !== undefined) {
          const color = cleanColor(body.color)
          if (color === undefined) {
            sendJson(res, 400, { error: 'color must be one of: ' + COLORS.join(', ') })
            return
          }
          patch.color = color
        }
        if (Object.keys(patch).length === 0) {
          sendJson(res, 400, { error: 'nothing to update: give text, date, color, and/or done' })
          return
        }
        const note = await store.update(id, patch)
        if (note === undefined) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        sendJson(res, 200, { note })
        return
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id') ?? ''
        if (id === '') {
          sendJson(res, 400, { error: 'id query parameter is required' })
          return
        }
        const removed = await store.remove(id)
        if (!removed) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 405, { error: `method not allowed: ${method}` })
    } catch (error) {
      console.error('[sticky-notes] request failed:', error)
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: API_PATH, handler }),
    'sticky-notes: routes',
  )

  // The tools service is optional: a profile without it keeps the page working.
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    ctx.effect(() => tools.register(makeTaskRecordsTool(store)), 'sticky-notes: tool')
  }
}
