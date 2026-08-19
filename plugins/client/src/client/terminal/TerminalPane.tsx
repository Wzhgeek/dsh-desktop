// Author: Zihan Wang
// <wangzh011031@163.com>
/** One xterm + PTY session. Stays mounted while its tab exists. */

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { closeTerminal } from './store.ts'

export interface TerminalPaneProps {
  tabId: string
  cwd: string | undefined
  hidden: boolean
}

interface LiveTerminal {
  term: Terminal
  fit: FitAddon
  id: string
  disposeData: () => void
  disposeExit: () => void
}

export function TerminalPane({ tabId, cwd, hidden }: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<LiveTerminal | undefined>(undefined)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const [notice, setNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    const host = hostRef.current
    const api = window.dshDesktop
    if (host === null || api === undefined) {
      setNotice('当前环境没有原生终端。')
      return
    }
    let cancelled = false
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#171719',
        foreground: '#e8e8ea',
        cursor: '#e8e8ea',
        selectionBackground: 'rgba(79,140,255,.35)',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    const cols = Math.max(20, term.cols)
    const rows = Math.max(8, term.rows)
    const directory = cwdRef.current
    const request = directory === undefined ? { cols, rows } : { cwd: directory, cols, rows }
    void api.createPty(request).then((result) => {
      if (cancelled) {
        term.dispose()
        if (result.ok) api.killPty(result.id)
        return
      }
      if (!result.ok) {
        term.dispose()
        setNotice(result.error)
        return
      }
      setNotice(undefined)
      const disposeData = api.onPtyData((payload) => {
        if (payload.id === result.id) term.write(payload.data)
      })
      const disposeExit = api.onPtyExit((payload) => {
        if (payload.id !== result.id) return
        closeTerminal(tabId)
      })
      term.onData((data) => { api.writePty(result.id, data) })
      liveRef.current = { term, fit, id: result.id, disposeData, disposeExit }
      fit.fit()
      api.resizePty(result.id, term.cols, term.rows)
      term.focus()
    })
    return () => {
      cancelled = true
      teardown(liveRef.current)
      liveRef.current = undefined
    }
  }, [tabId])

  useLayoutEffect(() => {
    if (hidden) return
    fitLive(liveRef.current)
    liveRef.current?.term.focus()
  }, [hidden])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const observer = new ResizeObserver(() => {
      if (!hidden) fitLive(liveRef.current)
    })
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [hidden])

  return (
    <div className="dsh-terminal-pane" hidden={hidden} data-tab={tabId}>
      {notice === undefined ? null : <p className="dsh-terminal-notice">{notice}</p>}
      <div className="dsh-terminal-host" ref={hostRef} hidden={notice !== undefined} />
    </div>
  )
}

function fitLive(live: LiveTerminal | undefined): void {
  if (live === undefined) return
  live.fit.fit()
  window.dshDesktop?.resizePty(live.id, live.term.cols, live.term.rows)
}

function teardown(live: LiveTerminal | undefined): void {
  if (live === undefined) return
  live.disposeData()
  live.disposeExit()
  try {
    live.term.dispose()
  } catch {
    // Disposed terminals are ignored.
  }
  window.dshDesktop?.killPty(live.id)
}
