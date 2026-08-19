// Author: Zihan Wang
// <wangzh011031@163.com>
/** Session-header controls: open the terminal, dock it below or to the right. */

import PanelBottom from 'lucide-react/dist/esm/icons/panel-bottom.mjs'
import PanelRight from 'lucide-react/dist/esm/icons/panel-right.mjs'
import SquareTerminal from 'lucide-react/dist/esm/icons/square-terminal.mjs'
import { useEffect, useState } from 'react'
import {
  addTerminal,
  getTerminalState,
  setTerminalOpen,
  setTerminalPlacement,
  subscribeTerminal,
} from './store.ts'

export function TerminalHeader(): JSX.Element {
  const [state, setState] = useState(getTerminalState)
  useEffect(() => subscribeTerminal(() => { setState(getTerminalState()) }), [])

  return (
    <div className="dsh-terminal-header" role="toolbar" aria-label="终端">
      <style>{HEADER_CSS}</style>
      <button
        type="button"
        title={state.open ? '新建终端' : '打开终端'}
        aria-pressed={state.open}
        onClick={() => { addTerminal() }}
      >
        <SquareTerminal size={15} />
        <span>终端</span>
      </button>
      <button
        type="button"
        title="放到对话下方"
        aria-pressed={state.open && state.placement === 'bottom'}
        onClick={() => { setTerminalPlacement('bottom'); setTerminalOpen(true) }}
      >
        <PanelBottom size={15} />
      </button>
      <button
        type="button"
        title="放到对话右侧"
        aria-pressed={state.open && state.placement === 'right'}
        onClick={() => { setTerminalPlacement('right'); setTerminalOpen(true) }}
      >
        <PanelRight size={15} />
      </button>
    </div>
  )
}

const HEADER_CSS = `
.dsh-terminal-header { display:inline-flex; align-items:center; gap:4px; }
.dsh-terminal-header button { height:32px; min-width:32px; padding:0 8px; display:inline-flex; align-items:center; justify-content:center; gap:5px; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); border-radius:6px; color:var(--dsw-alias-label-secondary,#999); background:transparent; cursor:pointer; font:inherit; font-size:12px; line-height:18px; }
.dsh-terminal-header button:hover, .dsh-terminal-header button[aria-pressed="true"] { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-terminal-header button:focus-visible { outline:2px solid var(--dsh-desktop-accent,#4f8cff); outline-offset:2px; }
`
