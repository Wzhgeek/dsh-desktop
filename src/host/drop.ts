// Author: Zihan Wang
// <wangzh011031@163.com>
/** Classify and bound desktop drag-and-drop paths. */

export const MAX_DROP_PATHS = 16
export const MAX_INBOX_BYTES = 80 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif'])

export type DropKind = 'directory' | 'pdf' | 'image' | 'file'

export interface DropClassification {
  path: string
  kind: DropKind
}

/** Classify a dropped local path from its extension and directory bit. */
export function classifyDroppedPath(path: string, isDirectory: boolean): DropClassification {
  const normalized = path.replace(/[/\\]+$/, '')
  if (isDirectory) return { path: normalized, kind: 'directory' }
  const ext = extensionOf(normalized)
  if (ext === '.pdf') return { path: normalized, kind: 'pdf' }
  if (IMAGE_EXTENSIONS.has(ext)) return { path: normalized, kind: 'image' }
  return { path: normalized, kind: 'file' }
}

function extensionOf(path: string): string {
  const base = path.split(/[/\\]/).at(-1) ?? ''
  const index = base.lastIndexOf('.')
  return index <= 0 ? '' : base.slice(index).toLocaleLowerCase()
}
