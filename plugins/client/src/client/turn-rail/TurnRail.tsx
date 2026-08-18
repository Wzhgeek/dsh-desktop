/** Codex-style fixed turn navigator for the active Chat transcript. */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { deriveTurnRailItems, turnRailMarkWidth } from './turns.ts'
import type { TurnRailItem } from './turns.ts'

export type TurnRailProps = PropsRuntime<'conversation.session.header.utilities'>

interface RailPosition {
  left: number
  top: number
  height: number
}

interface TooltipState {
  key: string
  left: number
  top: number
}

const CHAT_SCROLL_SELECTOR = '[data-conversation-scroll]'
const CHAT_FLOW_SELECTOR = '[data-chat-flow]'
const CHAT_ANCHOR_SELECTOR = '[data-chat-anchor-key]'
const COMPOSER_SELECTOR = '[data-composer-seat]'

/** Session utility controller whose fixed child stays outside transcript layout. */
export function TurnRail({ useSession }: TurnRailProps): JSX.Element | null {
  const legacyNodes = useSession(snapshot => snapshot.nodes)
  const order = useSession(snapshot => snapshot.chat.order)
  const nodeStore = useSession(snapshot => snapshot.chat.nodes)
  const sessionTurns = useMemo(() => deriveTurnRailItems(legacyNodes, order, nodeStore), [legacyNodes, nodeStore, order])
  const [renderedTurns, setRenderedTurns] = useState<TurnRailItem[]>([])
  const turns = sessionTurns.length > 0 ? sessionTurns : renderedTurns
  const railRef = useRef<HTMLElement>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const [position, setPosition] = useState<RailPosition | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const tooltipId = useId()

  useEffect(() => {
    const rail = railRef.current
    const conversationRoot = conversationRootForRail(rail)
    if (rail === null || conversationRoot === null) return
    let frame = 0

    const sync = (): void => {
      frame = 0
      const scrollport = directConversationScroll(conversationRoot)
      const flow = scrollport?.querySelector<HTMLElement>(CHAT_FLOW_SELECTOR) ?? null
      const next = flow === null ? [] : renderedTurnItems(flow)
      setRenderedTurns(current => sameTurns(current, next) ? current : next)
    }
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(sync)
    }
    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(conversationRoot, { childList: true, subtree: true, characterData: true })
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const rail = railRef.current
    const conversationRoot = conversationRootForRail(rail)
    if (rail === null || conversationRoot === null) return
    let frame = 0
    let observedScrollport: HTMLElement | null = null
    let resizeObserver: ResizeObserver | null = null

    const sync = (): void => {
      frame = 0
      const scrollport = directConversationScroll(conversationRoot)
      const flow = scrollport?.querySelector<HTMLElement>(CHAT_FLOW_SELECTOR) ?? null
      if (scrollport === null || scrollport === undefined || flow === null || turns.length === 0) {
        setPosition(null)
        setTooltip(null)
        return
      }
      if (observedScrollport !== scrollport) {
        observedScrollport?.removeEventListener('scroll', schedule)
        observedScrollport = scrollport
        observedScrollport.addEventListener('scroll', schedule, { passive: true })
      }
      const composer = flow.querySelector<HTMLElement>(COMPOSER_SELECTOR)
        ?? conversationRoot.querySelector<HTMLElement>(COMPOSER_SELECTOR)
      resizeObserver?.observe(scrollport)
      resizeObserver?.observe(flow)
      if (composer !== null) resizeObserver?.observe(composer)
      const scrollRect = scrollport.getBoundingClientRect()
      const flowRect = flow.getBoundingClientRect()
      const composerTop = composer?.getBoundingClientRect().top ?? scrollRect.bottom
      const top = Math.max(scrollRect.top + 12, flowRect.top + 8)
      const bottom = Math.min(scrollRect.bottom - 12, composerTop - 10)
      const height = Math.max(0, bottom - top)
      if (height < 72) {
        setPosition(null)
        setTooltip(null)
        return
      }
      setPosition({
        left: scrollRect.left,
        top,
        height,
      })
      setActiveKey(activeTurnKey(flow, scrollport, turns))
    }

    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(sync)
    }
    resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    sync()
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(conversationRoot, { attributes: true, childList: true, subtree: true, attributeFilter: ['aria-selected'] })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      observedScrollport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [turns])

  const jumpTo = useCallback((item: TurnRailItem) => {
    const rail = railRef.current
    const conversationRoot = conversationRootForRail(rail)
    const scrollport = conversationRoot === null ? null : directConversationScroll(conversationRoot)
    const flow = scrollport?.querySelector<HTMLElement>(CHAT_FLOW_SELECTOR) ?? null
    if (scrollport === null || flow === null) return
    const row = anchorElement(flow, item.key)
    if (row === null) return
    const offset = row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - 12
    scrollport.scrollTo({
      top: Math.max(0, scrollport.scrollTop + offset),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    setActiveKey(item.key)
  }, [])

  const revealTooltip = useCallback((item: TurnRailItem, button: HTMLButtonElement) => {
    if (position === null) return
    const rect = button.getBoundingClientRect()
    const width = 224
    const estimatedHeight = 72
    setTooltip({
      key: item.key,
      left: Math.min(window.innerWidth - width - 10, rect.right + 8),
      top: Math.max(position.top, Math.min(rect.top - 12, position.top + position.height - estimatedHeight)),
    })
  }, [position])

  const moveFocus = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1)
    else if (event.key === 'ArrowDown') nextIndex = Math.min(turns.length - 1, index + 1)
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = turns.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const next = turns[nextIndex]
    if (next !== undefined) buttonRefs.current.get(next.key)?.focus()
  }, [turns])

  if (position === null || turns.length === 0) return (
    <nav className="dsh-turn-rail dsh-turn-rail-hidden" ref={railRef} aria-hidden="true">
      <style>{TURN_RAIL_CSS}</style>
    </nav>
  )

  const activeTooltip = tooltip === null ? undefined : turns.find(item => item.key === tooltip.key)
  const emphasisKey = tooltip?.key ?? activeKey
  const emphasisIndex = turns.findIndex(item => item.key === emphasisKey)
  return (
    <nav
      className="dsh-turn-rail"
      ref={railRef}
      aria-label="会话轮次导航"
      style={{ left: position.left, top: position.top, height: position.height }}
    >
      <style>{TURN_RAIL_CSS}</style>
      <div className="dsh-turn-rail-items">
        {turns.map((item, index) => {
          const active = item.key === activeKey
          const described = item.key === tooltip?.key
          return (
            <button
              type="button"
              className="dsh-turn-rail-button"
              key={item.key}
              ref={(node) => {
                if (node === null) buttonRefs.current.delete(item.key)
                else buttonRefs.current.set(item.key, node)
              }}
              aria-label={`跳转到第 ${item.number} 轮：${item.summary}`}
              aria-current={active ? 'step' : undefined}
              aria-describedby={described ? tooltipId : undefined}
              style={{ '--dsh-turn-rail-mark-width': `${String(turnRailMarkWidth(index, emphasisIndex))}px` } as CSSProperties}
              onClick={() => jumpTo(item)}
              onKeyDown={(event) => moveFocus(event, index)}
              onMouseEnter={(event: MouseEvent<HTMLButtonElement>) => revealTooltip(item, event.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={(event: FocusEvent<HTMLButtonElement>) => {
                if (event.currentTarget.matches(':focus-visible')) revealTooltip(item, event.currentTarget)
              }}
              onBlur={() => setTooltip(null)}
            >
              <span className="dsh-turn-rail-mark" aria-hidden="true" />
            </button>
          )
        })}
      </div>
      {activeTooltip === undefined ? null : (
        <aside
          className="dsh-turn-rail-tooltip"
          id={tooltipId}
          role="tooltip"
          style={{ left: tooltip?.left, top: tooltip?.top }}
        >
          <strong>第 {activeTooltip.number} 轮</strong>
          <span>{activeTooltip.summary}</span>
        </aside>
      )}
    </nav>
  )
}

function directConversationScroll(root: HTMLElement): HTMLElement | null {
  for (const child of root.children) {
    if (child instanceof HTMLElement && child.matches(CHAT_SCROLL_SELECTOR)) return child
  }
  return root.querySelector<HTMLElement>(CHAT_SCROLL_SELECTOR)
}

function conversationRootForRail(rail: HTMLElement | null): HTMLElement | null {
  return rail?.closest<HTMLElement>('[data-phase]')
    ?? rail?.closest<HTMLElement>('[data-slot="conversation"]')
    ?? null
}

function anchorElement(flow: HTMLElement, key: string): HTMLElement | null {
  for (const row of flow.querySelectorAll<HTMLElement>(CHAT_ANCHOR_SELECTOR)) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

function activeTurnKey(flow: HTMLElement, scrollport: HTMLElement, turns: readonly TurnRailItem[]): string | null {
  const threshold = scrollport.getBoundingClientRect().top + Math.min(96, scrollport.clientHeight * 0.22)
  const anchors = new Map<string, HTMLElement>()
  for (const row of flow.querySelectorAll<HTMLElement>(CHAT_ANCHOR_SELECTOR)) {
    const key = row.dataset.chatAnchorKey
    if (key !== undefined) anchors.set(key, row)
  }
  let active: string | null = turns[0]?.key ?? null
  for (const item of turns) {
    const row = anchors.get(item.key)
    if (row === undefined) continue
    if (row.getBoundingClientRect().top > threshold) break
    active = item.key
  }
  return active
}

/** Project the already-rendered flow when an older runtime omits durable user nodes. */
function renderedTurnItems(flow: HTMLElement): TurnRailItem[] {
  const rows = [...flow.querySelectorAll<HTMLElement>(CHAT_ANCHOR_SELECTOR)]
  const userIndexes = rows.flatMap((row, index) => row.dataset.chatFlowKind === 'user' ? [index] : [])
  return userIndexes.flatMap((rowIndex, index) => {
    const row = rows[rowIndex]
    const key = row?.dataset.chatAnchorKey
    if (row === undefined || key === undefined) return []
    const nextIndex = userIndexes[index + 1] ?? rows.length
    const contentLength = Math.max(1, rows.slice(rowIndex, nextIndex).reduce((total, item) => (
      total + (item.textContent?.trim().length ?? 0)
    ), 0))
    return [{
      key,
      number: index + 1,
      summary: renderedUserSummary(row),
      contentLength,
      expandedWidth: Math.min(24, 14 + Math.round(Math.log2(contentLength + 1) * 1.2)),
    }]
  })
}

function renderedUserSummary(row: HTMLElement): string {
  const value = (row.innerText || row.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}\s*$/, '')
    .trim()
  if (value === '') return '图片或附件消息'
  return value.length <= 88 ? value : `${value.slice(0, 87).trimEnd()}…`
}

function sameTurns(current: readonly TurnRailItem[], next: readonly TurnRailItem[]): boolean {
  return current.length === next.length && current.every((item, index) => {
    const candidate = next[index]
    return candidate !== undefined
      && item.key === candidate.key
      && item.number === candidate.number
      && item.summary === candidate.summary
      && item.contentLength === candidate.contentLength
      && item.expandedWidth === candidate.expandedWidth
  })
}

const TURN_RAIL_CSS = `
.dsh-turn-rail {
  position: fixed;
  z-index: 6;
  width: 24px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
  color: var(--dsw-alias-label-tertiary, #8b8b93);
}
.dsh-turn-rail-hidden { display: none; }
.dsh-turn-rail-items {
  width: 24px;
  max-height: 100%;
  margin: auto 0;
  padding: 4px 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: safe center;
  gap: 2px;
  overflow: hidden auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  pointer-events: auto;
}
.dsh-turn-rail-items::-webkit-scrollbar { display: none; }
.dsh-turn-rail-button {
  width: 24px;
  height: 15px;
  min-height: 15px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  border: 0;
  outline: 0;
  background: transparent;
  cursor: pointer;
}
.dsh-turn-rail-mark {
  width: var(--dsh-turn-rail-mark-width, 10px);
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  opacity: .52;
  transition: width 130ms ease, height 110ms ease, opacity 110ms ease, color 110ms ease;
}
.dsh-turn-rail-button:hover .dsh-turn-rail-mark,
.dsh-turn-rail-button:focus-visible .dsh-turn-rail-mark {
  height: 3px;
  opacity: .92;
  color: var(--dsh-desktop-accent, var(--dsw-alias-state-business-primary, #6d5ce7));
}
.dsh-turn-rail-button[aria-current="step"] .dsh-turn-rail-mark {
  height: 3px;
  opacity: .92;
  color: var(--dsh-desktop-accent, var(--dsw-alias-state-business-primary, #6d5ce7));
}
.dsh-turn-rail-button:focus-visible {
  border-radius: 3px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsh-desktop-accent, #6d5ce7) 30%, transparent);
}
.dsh-turn-rail-tooltip {
  position: fixed;
  z-index: 6;
  width: 224px;
  max-height: 72px;
  box-sizing: border-box;
  padding: 9px 11px 10px;
  display: grid;
  gap: 3px;
  overflow: hidden;
  pointer-events: none;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 6px;
  color: var(--dsw-alias-label-primary, #f1f1f3);
  background: var(--dsw-alias-bg-layer-2, #242427);
  box-shadow: var(--dsw-shadow-lv2, 0 8px 24px rgba(0,0,0,.28));
}
.dsh-turn-rail-tooltip strong { font-size: 11px; line-height: 16px; font-weight: 600; }
.dsh-turn-rail-tooltip span {
  display: -webkit-box;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, #b0b0b6);
  font-size: 11px;
  line-height: 16px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
@media (max-width: 760px) { .dsh-turn-rail { display: none; } }
@media (prefers-reduced-motion: reduce) { .dsh-turn-rail-mark { transition: none; } }
`
