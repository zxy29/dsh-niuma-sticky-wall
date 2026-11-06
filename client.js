/**
 * Sticky Wall — browser half.
 *
 * Contributes one row to the sidebar shell's own global panel list
 * (`sidebar.panellist`) and one page to the layout's keyed `main` slot. The
 * shell owns the row box, label, tooltip, active highlight, collapsed rail and
 * the panel switch, exactly as it does for the shipped Plugins and Schedule
 * pages; this file only draws the glyph and the page.
 *
 * The page is a wall of colored paper cards: a warm composer with a swatch row
 * adds a record, and every record is a card carrying its own paper color, its
 * text, its calendar day (chosen in the composer, today by default) and the
 * time it was written. Cards are grouped by day — today first, then upcoming
 * days, then past days — and a past day that still has open records is flagged.
 *
 * Both registrations go through `ctx.slots.inject`, which fires once the owning
 * shell entry declares the seat, so load order against the shell does not
 * matter and a shell that cannot serve the seats leaves the panel absent
 * instead of throwing.
 *
 * Data lives on the Host half behind `/api/sticky-notes/notes`; the page reads
 * and writes through plain same-origin fetch. No Harness Client package is
 * imported: controls are local, styled with `--dsw-alias-*` theme tokens on the
 * page chrome and fixed paper colors on the cards themselves.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-sticky-notes',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Panel id shared by the sidebar row and the main-slot occupant. */
    const PANEL_ID = 'sticky-notes'

    /** Locale namespace this plugin owns. */
    const NS = 'sticky-notes'

    /** Same-origin route family served by the Host half. */
    const API_PATH = '/api/sticky-notes/notes'

    /** Row order among the shell's global panel rows (Plugins 0, Schedules 10). */
    const PANEL_ORDER = 20

    /** Card paper colors, in swatch order. */
    const COLORS = ['amber', 'rose', 'sky', 'sage', 'violet', 'sand']

    // ------------------------------------------------------------ locale

    const zh = {
      'entry.label': '牛马便签墙',
      'page.title': '牛马便签墙',
      'page.subtitle': '每个灵感，都值得记下。便签自动保存。',
      'page.pending': '条待办',
      'page.done': '条已完成',
      'page.count': '张便签',
      'page.placeholder': '写下你的下一个灵感……',
      'page.search': '搜索便签',
      'page.addToWall': '添加到墙上',
      'page.kbdHint': 'Ctrl/⌘ + Enter',
      'page.empty': '墙上还没有便签',
      'page.emptyHint': '在上面写一条，选个颜色和日期，按 Ctrl+Enter 贴到墙上。',
      'page.noMatch': '没有匹配的便签',
      'page.noMatchHint': '换个关键词试试。',
      'page.loading': '正在加载…',
      'page.loadFailed': '便签加载失败',
      'page.retry': '重试',
      'page.refresh': '刷新',
      'page.edit': '编辑',
      'page.delete': '删除',
      'page.save': '保存',
      'page.cancel': '取消',
      'page.reopen': '标记为未完成',
      'page.confirmDelete': '确认删除',
      'page.addFailed': '添加失败',
      'page.updateFailed': '更新失败',
      'page.deleteFailed': '删除失败',
      'page.textRequired': '便签内容不能为空',
      'date.label': '日期',
      'date.today': '今天',
      'date.tomorrow': '明天',
      'date.yesterday': '昨天',
      'date.overdue': '已逾期',
      'color.amber': '暖黄',
      'color.rose': '浅粉',
      'color.sky': '天蓝',
      'color.sage': '草绿',
      'color.violet': '雾紫',
      'color.sand': '沙色',
    }

    const en = {
      'entry.label': 'Sticky Wall',
      'page.title': 'Sticky Wall',
      'page.subtitle': 'Every idea is worth keeping. Saved automatically.',
      'page.pending': 'open',
      'page.done': 'done',
      'page.count': 'notes',
      'page.placeholder': 'Write down your next idea…',
      'page.search': 'Search notes',
      'page.addToWall': 'Add to wall',
      'page.kbdHint': 'Ctrl/⌘ + Enter',
      'page.empty': 'Nothing on the wall yet',
      'page.emptyHint': 'Write one above, pick a color and a date, then press Ctrl+Enter to pin it.',
      'page.noMatch': 'No matching notes',
      'page.noMatchHint': 'Try another keyword.',
      'page.loading': 'Loading…',
      'page.loadFailed': 'Could not load notes',
      'page.retry': 'Retry',
      'page.refresh': 'Refresh',
      'page.edit': 'Edit',
      'page.delete': 'Delete',
      'page.save': 'Save',
      'page.cancel': 'Cancel',
      'page.reopen': 'Mark as open',
      'page.confirmDelete': 'Delete it',
      'page.addFailed': 'Could not add the note',
      'page.updateFailed': 'Could not update the note',
      'page.deleteFailed': 'Could not delete the note',
      'page.textRequired': 'A note needs some text',
      'date.label': 'Date',
      'date.today': 'Today',
      'date.tomorrow': 'Tomorrow',
      'date.yesterday': 'Yesterday',
      'date.overdue': 'Overdue',
      'color.amber': 'Amber',
      'color.rose': 'Rose',
      'color.sky': 'Sky',
      'color.sage': 'Sage',
      'color.violet': 'Violet',
      'color.sand': 'Sand',
    }

    /** Locale service from apply; null when the profile has none. */
    let locale = null

    /** Namespace translate function from apply; null before activation. */
    let translate = null

    /** The active locale id, read at call time so a switch follows immediately. */
    function activeLocaleId() {
      if (locale !== null && typeof locale.getSnapshot === 'function') {
        try {
          const snapshot = locale.getSnapshot()
          if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.active === 'string' && snapshot.active !== '') {
            return snapshot.active
          }
        } catch {
          /* fall through to the browser preference */
        }
      }
      const language = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : 'en'
      return language
    }

    /** Whether the active locale reads as Chinese. */
    function isChinese() {
      return activeLocaleId().toLowerCase().startsWith('zh')
    }

    /**
     * Translate one key of this plugin's namespace.
     * @param {string} key - dotted key from the dictionaries above.
     * @returns {string} the active-locale text, else the platform text.
     */
    function t(key) {
      if (translate !== null) {
        try {
          const value = translate(key)
          if (typeof value === 'string' && value !== key) return value
        } catch {
          /* fall back to the bundled dictionary */
        }
      }
      const dictionary = isChinese() ? zh : en
      const value = dictionary[key]
      return typeof value === 'string' ? value : key
    }

    // -------------------------------------------------------------- data

    /** Human-readable reason for a failed API call. */
    function describe(reason) {
      if (reason !== null && typeof reason === 'object' && typeof reason.message === 'string' && reason.message !== '') return reason.message
      return String(reason)
    }

    /**
     * Fetch the route family.
     * @param {string} method - HTTP method.
     * @param {object} [body] - JSON body.
     * @param {string} [search] - query string beginning with `?`.
     * @returns {Promise<object>} the parsed JSON answer.
     */
    async function request(method, body, search) {
      const init = { method, cache: 'no-store' }
      if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(body)
      }
      const response = await fetch(API_PATH + (search === undefined ? '' : search), init)
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        const message = data !== null && typeof data === 'object' && typeof data.error === 'string' ? data.error : 'HTTP ' + response.status
        throw new Error(message)
      }
      return data === null ? {} : data
    }

    const api = {
      list: async () => {
        const data = await request('GET')
        return Array.isArray(data.notes) ? data.notes : []
      },
      add: async (text, date, color) => {
        const data = await request('POST', { text, date, color })
        return data.note
      },
      update: async (id, patch) => {
        const data = await request('PATCH', Object.assign({ id }, patch))
        return data.note
      },
      remove: async (id) => {
        await request('DELETE', undefined, '?id=' + encodeURIComponent(id))
      },
    }

    /** Whether a stored card color id is one this page knows. */
    function normalizeColor(value) {
      return COLORS.includes(value) ? value : COLORS[0]
    }

    // ------------------------------------------------------------- icons

    /** Shared stroke-icon frame. */
    function icon(size, children, strokeWidth) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: strokeWidth === undefined ? 1.4 : strokeWidth,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        children,
      )
    }

    /** The sidebar row glyph: a sticky note with a folded corner. */
    function StickyNotesIcon(props) {
      const size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 16
      return icon(size, [
        h('path', { key: 'sheet', d: 'M3 2.5h10v7.25L9.25 13.5H3z' }),
        h('path', { key: 'fold', d: 'M13 9.75H9.75a.5.5 0 0 0-.5.5V13.5' }),
        h('path', { key: 'line1', d: 'M5.25 5.5h5.5' }),
        h('path', { key: 'line2', d: 'M5.25 7.75h3.5' }),
      ])
    }

    /** Checked state mark. */
    function checkIcon() {
      return icon(11, [h('path', { key: 'check', d: 'M3.4 8.4l3 3 6.2-7', strokeWidth: 2.2 })])
    }

    /** Pencil. */
    function pencilIcon() {
      return icon(14, [
        h('path', { key: 'body', d: 'M10.9 2.9l2.2 2.2-7.6 7.6-2.9.7.7-2.9z' }),
        h('path', { key: 'nik', d: 'M9.4 4.4l2.2 2.2' }),
      ])
    }

    /** Trash can. */
    function trashIcon() {
      return icon(14, [
        h('path', { key: 'lid', d: 'M2.75 4.5h10.5' }),
        h('path', { key: 'handle', d: 'M6 4.5V3h4v1.5' }),
        h('path', { key: 'body', d: 'M4.25 4.5l.6 8.25h6.3l.6-8.25' }),
      ])
    }

    /** Magnifier. */
    function searchIcon() {
      return icon(14, [h('circle', { key: 'ring', cx: 7, cy: 7, r: 4.25 }), h('path', { key: 'handle', d: 'M10.4 10.4l3 3' })])
    }

    /** Plus. */
    function plusIcon() {
      return icon(13, [h('path', { key: 'v', d: 'M8 3.5v9' }), h('path', { key: 'h', d: 'M3.5 8h9' })], 1.8)
    }

    /** Refresh arrow. */
    function refreshIcon() {
      return icon(14, [h('path', { key: 'arc', d: 'M13 8a5 5 0 1 1-1.6-3.7' }), h('path', { key: 'tip', d: 'M13 2.75V5.5h-2.75' })])
    }

    // --------------------------------------------------------- date & time

    /** True while an IME composition owns the Enter key. */
    function isComposing(event) {
      if (event === null || typeof event !== 'object') return false
      if (event.isComposing === true) return true
      if (event.nativeEvent !== null && typeof event.nativeEvent === 'object' && event.nativeEvent.isComposing === true) return true
      return event.keyCode === 229
    }

    /** Local calendar day of one Date, as `YYYY-MM-DD`. */
    function dayKeyOf(date) {
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return date.getFullYear() + '-' + month + '-' + day
    }

    /** Today's local calendar day. */
    function todayKey() {
      return dayKeyOf(new Date())
    }

    /** The local calendar day `offset` whole days from today. */
    function shiftedDayKey(offset) {
      const date = new Date()
      date.setDate(date.getDate() + offset)
      return dayKeyOf(date)
    }

    /** Local midnight Date for one `YYYY-MM-DD` key. */
    function parseDayKey(key) {
      const parts = key.split('-')
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    }

    /** Header text for one calendar day: 今天/明天/昨天, else a localized date. */
    function dayLabel(key) {
      if (key === todayKey()) return t('date.today')
      if (key === shiftedDayKey(1)) return t('date.tomorrow')
      if (key === shiftedDayKey(-1)) return t('date.yesterday')
      try {
        return parseDayKey(key).toLocaleDateString(isChinese() ? 'zh-CN' : 'en', { month: 'short', day: 'numeric', weekday: 'short' })
      } catch {
        return key
      }
    }

    /** Short calendar date for one `YYYY-MM-DD` key (e.g. 11月5日 / Nov 5). */
    function shortDateLabel(key) {
      if (typeof key !== 'string' || key === '') return ''
      try {
        return parseDayKey(key).toLocaleDateString(isChinese() ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' })
      } catch {
        return key
      }
    }

    /** Time of day one record was written. */
    function timeLabel(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString(isChinese() ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    // --------------------------------------------------------------- view

    /** Centered placeholder block. */
    function emptyBlock(title, extra) {
      return h(
        'div',
        { className: 'dsn-empty' },
        h('span', { className: 'dsn-empty-title' }, title),
        extra === undefined || extra === null ? null : extra,
      )
    }

    /** The sticky wall mounted into the layout's `main` slot. */
    function StickyNotesPage() {
      const [notes, setNotes] = React.useState([])
      const [status, setStatus] = React.useState('loading')
      const [draft, setDraft] = React.useState('')
      const [draftDate, setDraftDate] = React.useState(todayKey())
      const [draftColor, setDraftColor] = React.useState(COLORS[0])
      const [search, setSearch] = React.useState('')
      const [error, setError] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [editing, setEditing] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
      const [, setLocaleVersion] = React.useState(0)

      function reload() {
        setStatus('loading')
        setError('')
        api
          .list()
          .then((list) => {
            setNotes(list)
            setStatus('ready')
          })
          .catch((reason) => {
            setStatus('error')
            setError(t('page.loadFailed') + ' — ' + describe(reason))
          })
      }

      React.useEffect(() => {
        reload()
      }, [])

      // A locale switch must repaint the page text; the service bumps its
      // revision on every switch and on late dictionary registration.
      React.useEffect(() => {
        if (locale === null || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setLocaleVersion((value) => value + 1))
      }, [])

      async function submit() {
        const text = draft.trim()
        if (text === '' || saving) return
        const date = draftDate === '' ? todayKey() : draftDate
        setSaving(true)
        setError('')
        try {
          const note = await api.add(text, date, draftColor)
          setNotes((list) => list.concat([note]))
          setDraft('')
          setDraftDate(todayKey())
          setStatus('ready')
        } catch (reason) {
          setError(t('page.addFailed') + ' — ' + describe(reason))
        } finally {
          setSaving(false)
        }
      }

      async function toggle(note) {
        const next = Object.assign({}, note, { done: !note.done, updatedAt: Date.now() })
        setError('')
        setNotes((list) => list.map((entry) => (entry.id === note.id ? next : entry)))
        try {
          const saved = await api.update(note.id, { done: next.done })
          setNotes((list) => list.map((entry) => (entry.id === note.id ? saved : entry)))
        } catch (reason) {
          setNotes((list) => list.map((entry) => (entry.id === note.id ? note : entry)))
          setError(t('page.updateFailed') + ' — ' + describe(reason))
        }
      }

      async function remove(note) {
        const previous = notes
        setError('')
        setConfirming(null)
        if (editing !== null && editing.id === note.id) setEditing(null)
        setNotes((list) => list.filter((entry) => entry.id !== note.id))
        try {
          await api.remove(note.id)
        } catch (reason) {
          setNotes(previous)
          setError(t('page.deleteFailed') + ' — ' + describe(reason))
        }
      }

      async function saveEdit() {
        if (editing === null) return
        const text = editing.text.trim()
        if (text === '') {
          setError(t('page.textRequired'))
          return
        }
        const id = editing.id
        const current = notes.find((entry) => entry.id === id)
        const fallback = current === undefined ? todayKey() : current.date
        const date = editing.date === undefined || editing.date === '' ? fallback : editing.date
        setEditing(null)
        setError('')
        try {
          const saved = await api.update(id, { text, date, color: editing.color })
          setNotes((list) => list.map((entry) => (entry.id === id ? saved : entry)))
        } catch (reason) {
          setError(t('page.updateFailed') + ' — ' + describe(reason))
        }
      }

      /** One color dot of a swatch row. */
      function swatch(id, active, onPick, small) {
        return h('button', {
          key: id,
          type: 'button',
          className: 'dsn-swatch dsn-swatch-' + id + (active === id ? ' is-active' : '') + (small === true ? ' is-small' : ''),
          title: t('color.' + id),
          'aria-label': t('color.' + id),
          'aria-pressed': active === id,
          onClick: onPick,
        })
      }

      function renderCard(note) {
        const color = normalizeColor(note.color)
        const isEditing = editing !== null && editing.id === note.id
        const isConfirming = confirming !== null && confirming === note.id
        const overdue = note.done !== true && typeof note.date === 'string' && note.date < todayKey()
        const cardClass = 'dsn-card dsn-c-' + color + (note.done === true ? ' dsn-card-done' : '')

        if (isEditing) {
          return h(
            'div',
            { key: note.id, className: cardClass },
            h('textarea', {
              className: 'dsn-card-edit',
              rows: 3,
              value: editing.text,
              autoFocus: true,
              onChange: (event) => setEditing({ id: note.id, text: event.target.value, date: editing.date, color: editing.color }),
              onKeyDown: (event) => {
                if (isComposing(event)) return
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(null)
                } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  saveEdit()
                }
              },
            }),
            h(
              'div',
              { className: 'dsn-card-editrow' },
              h('input', {
                type: 'date',
                className: 'dsn-date dsn-date-paper',
                value: editing.date,
                'aria-label': t('date.label'),
                onChange: (event) => setEditing({ id: note.id, text: editing.text, date: event.target.value, color: editing.color }),
              }),
              h(
                'div',
                { className: 'dsn-swatches' },
                COLORS.map((id) => swatch(id, editing.color, () => setEditing({ id: note.id, text: editing.text, date: editing.date, color: id }), true)),
              ),
            ),
            h(
              'div',
              { className: 'dsn-card-foot' },
              h(
                'div',
                { className: 'dsn-card-actions is-visible' },
                h('button', { type: 'button', className: 'dsn-card-btn dsn-card-textbtn', onClick: saveEdit }, t('page.save')),
                h('button', { type: 'button', className: 'dsn-card-btn dsn-card-textbtn', onClick: () => setEditing(null) }, t('page.cancel')),
              ),
            ),
          )
        }

        return h(
          'div',
          { key: note.id, className: cardClass },
          h('div', { className: 'dsn-card-text' }, note.text),
          h(
            'div',
            { className: 'dsn-card-foot' },
            h(
              'div',
              { className: 'dsn-card-meta' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsn-check' + (note.done === true ? ' is-on' : ''),
                  role: 'checkbox',
                  'aria-checked': note.done === true,
                  title: note.done === true ? t('page.reopen') : t('page.done'),
                  onClick: () => toggle(note),
                },
                note.done === true ? checkIcon() : null,
              ),
              h('span', { className: 'dsn-date-chip' }, shortDateLabel(note.date)),
              h('span', { className: 'dsn-time' }, timeLabel(note.createdAt)),
              overdue ? h('span', { className: 'dsn-overdue-chip' }, t('date.overdue')) : null,
            ),
            h(
              'div',
              { className: 'dsn-card-actions' },
              isConfirming
                ? [
                    h('button', { key: 'confirm', type: 'button', className: 'dsn-card-btn dsn-card-textbtn dsn-danger', onClick: () => remove(note) }, t('page.confirmDelete')),
                    h('button', { key: 'cancel', type: 'button', className: 'dsn-card-btn dsn-card-textbtn', onClick: () => setConfirming(null) }, t('page.cancel')),
                  ]
                : [
                    h(
                      'button',
                      {
                        key: 'edit',
                        type: 'button',
                        className: 'dsn-card-btn',
                        title: t('page.edit'),
                        'aria-label': t('page.edit'),
                        onClick: () => {
                          setConfirming(null)
                          setEditing({ id: note.id, text: note.text, date: note.date, color })
                        },
                      },
                      pencilIcon(),
                    ),
                    h(
                      'button',
                      {
                        key: 'delete',
                        type: 'button',
                        className: 'dsn-card-btn',
                        title: t('page.delete'),
                        'aria-label': t('page.delete'),
                        onClick: () => setConfirming(note.id),
                      },
                      trashIcon(),
                    ),
                  ],
            ),
          ),
        )
      }

      // Search narrows the wall; grouping and counts then describe what is
      // actually on screen.
      const term = search.trim().toLowerCase()
      const visible = term === '' ? notes : notes.filter((note) => String(note.text).toLowerCase().includes(term))

      const pending = visible.filter((note) => note.done !== true)
      const completed = visible.filter((note) => note.done === true)
      const today = todayKey()
      const byDate = new Map()
      for (const note of visible) {
        const key = typeof note.date === 'string' && note.date !== '' ? note.date : today
        const bucket = byDate.get(key)
        if (bucket === undefined) byDate.set(key, [note])
        else bucket.push(note)
      }
      for (const bucket of byDate.values()) {
        bucket.sort((a, b) => (a.done === b.done ? b.createdAt - a.createdAt : a.done ? 1 : -1))
      }
      const upcoming = Array.from(byDate.keys()).filter((key) => key > today).sort()
      const past = Array.from(byDate.keys()).filter((key) => key < today).sort().reverse()
      const order = (byDate.has(today) ? [today] : []).concat(upcoming, past)

      function renderGroup(key) {
        const bucket = byDate.get(key) === undefined ? [] : byDate.get(key)
        const open = bucket.filter((note) => note.done !== true).length
        const overdue = key < today && open > 0
        const summary = open > 0 ? open + ' ' + t('page.pending') : bucket.length + ' ' + t('page.done')
        return h(
          'section',
          { key: 'day:' + key, className: 'dsn-group' },
          h(
            'div',
            { className: 'dsn-group-head' + (overdue ? ' is-overdue' : '') },
            h('span', { className: 'dsn-group-title' }, dayLabel(key)),
            h('span', { className: 'dsn-group-count' }, summary),
            overdue ? h('span', { className: 'dsn-group-flag' }, t('date.overdue')) : null,
          ),
          h('div', { className: 'dsn-wall' }, bucket.map(renderCard)),
        )
      }

      let body
      if (notes.length === 0 && status === 'loading') {
        body = emptyBlock(t('page.loading'))
      } else if (notes.length === 0 && status === 'error') {
        body = emptyBlock(t('page.loadFailed'), h('button', { type: 'button', className: 'dsn-link-button', onClick: reload }, t('page.retry')))
      } else if (notes.length === 0) {
        body = emptyBlock(t('page.empty'), h('span', { className: 'dsn-empty-hint' }, t('page.emptyHint')))
      } else if (visible.length === 0) {
        body = emptyBlock(t('page.noMatch'), h('span', { className: 'dsn-empty-hint' }, t('page.noMatchHint')))
      } else {
        body = order.map(renderGroup)
      }

      const countText = term === '' ? visible.length + ' ' + t('page.count') : visible.length + ' / ' + notes.length + ' ' + t('page.count')

      return h(
        'div',
        { className: 'dsn-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dsn-content' },
          h(
            'header',
            { className: 'dsn-header' },
            h(
              'div',
              { className: 'dsn-heading' },
              h('h1', { className: 'dsn-title' }, t('page.title')),
              h('p', { className: 'dsn-subtitle' }, t('page.subtitle')),
            ),
            h(
              'div',
              { className: 'dsn-tools' },
              h(
                'label',
                { className: 'dsn-search' },
                searchIcon(),
                h('input', {
                  type: 'search',
                  value: search,
                  placeholder: t('page.search'),
                  'aria-label': t('page.search'),
                  onChange: (event) => setSearch(event.target.value),
                }),
              ),
              h('button', {
                type: 'button',
                className: 'dsn-ghost',
                title: t('page.refresh'),
                'aria-label': t('page.refresh'),
                disabled: status === 'loading',
                onClick: reload,
              }, refreshIcon()),
              h('span', { className: 'dsn-count' }, countText),
            ),
          ),
          h(
            'div',
            { className: 'dsn-composer' },
            h('textarea', {
              className: 'dsn-compose-input',
              rows: 2,
              value: draft,
              placeholder: t('page.placeholder'),
              autoFocus: true,
              spellCheck: false,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (isComposing(event)) return
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  submit()
                }
              },
            }),
            h(
              'div',
              { className: 'dsn-composer-foot' },
              h(
                'div',
                { className: 'dsn-composer-left' },
                h('div', { className: 'dsn-swatches' }, COLORS.map((id) => swatch(id, draftColor, () => setDraftColor(id), false))),
                h('input', {
                  type: 'date',
                  className: 'dsn-date',
                  value: draftDate,
                  'aria-label': t('date.label'),
                  title: t('date.label'),
                  onChange: (event) => setDraftDate(event.target.value),
                }),
              ),
              h(
                'div',
                { className: 'dsn-composer-right' },
                h('span', { className: 'dsn-kbd' }, t('page.kbdHint')),
                h(
                  'button',
                  { type: 'button', className: 'dsn-add', disabled: saving || draft.trim() === '', onClick: submit },
                  plusIcon(),
                  t('page.addToWall'),
                ),
              ),
            ),
          ),
          error === '' || (status === 'error' && notes.length === 0) ? null : h('p', { className: 'dsn-error', role: 'alert' }, error),
          h('div', { className: 'dsn-list' }, body),
        ),
      )
    }

    /**
     * Page chrome with theme tokens; cards use fixed paper colors because a
     * sticky note is physical paper whose ink stays dark in both themes.
     */
    const CSS = `
.dsn-root{height:100%;box-sizing:border-box;overflow-y:auto;padding:26px 30px 56px;color:var(--dsw-alias-label-primary);}
.dsn-content{max-width:1080px;margin:0 auto;}
.dsn-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:20px;}
.dsn-heading{min-width:0;}
.dsn-title{margin:0;font-size:22px;font-weight:600;line-height:1.25;letter-spacing:.2px;}
.dsn-subtitle{margin:7px 0 0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);}
.dsn-tools{display:flex;align-items:center;gap:10px;flex:none;}
.dsn-search{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);}
.dsn-search:focus-within{border-color:var(--dsw-alias-border-l2);}
.dsn-search input{width:150px;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;}
.dsn-search input::placeholder{color:var(--dsw-alias-label-secondary);}
.dsn-ghost{flex:none;display:grid;place-items:center;width:30px;height:30px;padding:0;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}
.dsn-ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.dsn-ghost:disabled{opacity:.45;cursor:default;}
.dsn-count{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.dsn-composer{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:16px 16px 12px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 14px 30px -24px rgba(0,0,0,.45);}
.dsn-compose-input{display:block;width:100%;box-sizing:border-box;min-height:62px;resize:vertical;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.6;}
.dsn-compose-input::placeholder{color:var(--dsw-alias-label-secondary);}
.dsn-composer-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:10px;}
.dsn-composer-left{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0;}
.dsn-composer-right{display:flex;align-items:center;gap:10px;flex:none;}
.dsn-swatches{display:flex;align-items:center;gap:8px;}
.dsn-swatch{width:20px;height:20px;padding:0;border:2px solid transparent;border-radius:999px;background-clip:padding-box;box-shadow:inset 0 0 0 1px rgba(74,59,22,.18);cursor:pointer;}
.dsn-swatch.is-small{width:16px;height:16px;border-width:1.5px;box-shadow:inset 0 0 0 1px rgba(58,55,46,.18);}
.dsn-swatch.is-active{border-color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px rgba(255,255,255,.55);}
.dsn-swatch-amber{background:#F3D46A;}
.dsn-swatch-rose{background:#F2AFBA;}
.dsn-swatch-sky{background:#A6C9E8;}
.dsn-swatch-sage{background:#B4D19E;}
.dsn-swatch-violet{background:#C2B0E4;}
.dsn-swatch-sand{background:#D9CDB2;}
.dsn-kbd{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.dsn-add{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:#2F2A21;color:#FFF6E4;font-size:13px;font-weight:600;cursor:pointer;}
.dsn-add:hover{background:#3D3629;}
.dsn-add:disabled{opacity:.55;cursor:default;}
.dsn-date{box-sizing:border-box;height:27px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;color-scheme:inherit;cursor:pointer;}
.dsn-date:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dsn-date-paper{background:rgba(255,255,255,.72);border-color:rgba(58,55,46,.22);color:#3A372E;color-scheme:light;}
.dsn-error{margin:12px 0 0;font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;overflow-wrap:anywhere;}
.dsn-list{display:flex;flex-direction:column;gap:26px;margin-top:22px;}
.dsn-group{display:flex;flex-direction:column;gap:10px;}
.dsn-group-head{display:flex;align-items:center;gap:8px;font-size:12px;}
.dsn-group-title{font-weight:600;color:var(--dsw-alias-label-primary);}
.dsn-group-count{color:var(--dsw-alias-label-secondary);}
.dsn-group-head.is-overdue .dsn-group-title{color:var(--dsw-alias-state-error-primary);}
.dsn-group-flag{padding:0 7px;border-radius:999px;background:var(--dsw-alias-state-error-primary);color:#fff;font-size:11px;line-height:17px;}
.dsn-wall{column-count:3;column-gap:14px;}
@media (max-width:1180px){.dsn-wall{column-count:2;}}
@media (max-width:760px){.dsn-wall{column-count:1;}}
.dsn-card{display:inline-flex;flex-direction:column;gap:10px;width:100%;box-sizing:border-box;margin:0 0 14px;padding:14px 14px 10px;border-radius:16px;background:#FCEFC0;color:#3A372E;box-shadow:0 1px 2px rgba(74,59,22,.10),0 12px 24px -18px rgba(74,59,22,.55);break-inside:avoid;page-break-inside:avoid;vertical-align:top;}
.dsn-c-amber{background:#FCEFC0;}
.dsn-c-rose{background:#FBE2E7;}
.dsn-c-sky{background:#DDEBF8;}
.dsn-c-sage{background:#E5F0D9;}
.dsn-c-violet{background:#EBE4F7;}
.dsn-c-sand{background:#F1EDE2;}
.dsn-card-text{font-size:13.5px;line-height:1.62;white-space:pre-wrap;overflow-wrap:anywhere;color:inherit;}
.dsn-card-done .dsn-card-text{text-decoration:line-through;color:rgba(58,55,46,.52);}
.dsn-card-edit{display:block;width:100%;box-sizing:border-box;min-height:56px;resize:vertical;padding:8px 9px;border:1px solid rgba(74,59,22,.18);border-radius:10px;background:rgba(255,255,255,.55);color:#3A372E;font:inherit;font-size:13.5px;line-height:1.62;outline:none;}
.dsn-card-editrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.dsn-card-edit .dsn-date,.dsn-card-editrow .dsn-date{background:rgba(255,255,255,.72);border-color:rgba(58,55,46,.18);color:#3A372E;color-scheme:light;}
.dsn-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:22px;}
.dsn-card-meta{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;}
.dsn-check{flex:none;display:grid;place-items:center;width:18px;height:18px;padding:0;border:1.5px solid rgba(58,55,46,.38);border-radius:999px;background:transparent;color:transparent;cursor:pointer;}
.dsn-check.is-on{border-color:#3A372E;background:#3A372E;color:#FFF8E7;}
.dsn-date-chip{padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.68);font-size:11px;line-height:15px;color:#3A372E;font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums;}
.dsn-time{font-size:11px;line-height:15px;color:rgba(58,55,46,.62);white-space:nowrap;font-variant-numeric:tabular-nums;}
.dsn-overdue-chip{padding:2px 8px;border-radius:999px;background:rgba(190,58,44,.18);font-size:11px;line-height:15px;color:#8E2A1F;font-weight:500;white-space:nowrap;}
.dsn-card-actions{display:flex;align-items:center;gap:2px;opacity:0;transition:opacity .12s ease;}
.dsn-card:hover .dsn-card-actions,.dsn-card:focus-within .dsn-card-actions,.dsn-card-actions.is-visible{opacity:1;}
.dsn-card-btn{display:grid;place-items:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:rgba(58,55,46,.55);cursor:pointer;}
.dsn-card-btn:hover{background:rgba(255,255,255,.6);color:#3A372E;}
.dsn-card-textbtn{display:inline-flex;width:auto;padding:0 8px;height:22px;font-size:11.5px;}
.dsn-card-textbtn.dsn-danger{color:#A93326;}
.dsn-card-textbtn.dsn-danger:hover{background:rgba(190,58,44,.14);color:#8E2A1F;}
.dsn-empty{display:flex;flex-direction:column;align-items:center;gap:7px;padding:52px 0 40px;text-align:center;}
.dsn-empty-title{font-size:13.5px;font-weight:500;}
.dsn-empty-hint{font-size:12px;color:var(--dsw-alias-label-secondary);}
.dsn-link-button{padding:4px 10px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;cursor:pointer;}
.dsn-link-button:hover{background:var(--dsw-alias-bg-layer-2);}
`

    // ------------------------------------------------------------- plugin

    /**
     * Mount the sidebar entry and the sticky wall.
     * @param {object} ctx - client root context (service: slots).
     */
    function apply(ctx) {
      // Dictionaries first: the row label and the page read them at call time.
      const localeService = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (localeService !== undefined && localeService !== null) {
        locale = localeService
        try {
          const disposers = []
          if (typeof localeService.register === 'function') {
            disposers.push(localeService.register(NS, 'zh', zh))
            disposers.push(localeService.register(NS, 'en', en))
          }
          if (typeof localeService.bind === 'function') translate = localeService.bind(NS)
          if (disposers.length > 0) {
            ctx.effect(() => () => {
              for (const dispose of disposers.splice(0)) {
                try {
                  dispose()
                } catch {
                  /* already gone */
                }
              }
            }, 'sticky-notes: dictionaries')
          }
        } catch (reason) {
          console.warn('[sticky-notes] locale registration failed:', reason)
        }
      }

      const slots = ctx.slots
      if (slots === undefined || slots === null) {
        console.warn('[sticky-notes] slot service unavailable; the panel stays unmounted')
        return
      }

      // The shell owns the row (button, label, tooltip, rail); this only draws
      // the glyph. The page lives in the layout's keyed `main` slot under the
      // same id, so the shell's own panel switch reaches it.
      ctx.effect(
        () =>
          slots.inject('sidebar.panellist', () =>
            slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('entry.label') }, StickyNotesIcon),
          ),
        'sticky-notes: sidebar entry',
      )

      ctx.effect(
        () => slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, StickyNotesPage)),
        'sticky-notes: page',
      )
    }

    return { inject: ['slots'], apply }
  },
})
