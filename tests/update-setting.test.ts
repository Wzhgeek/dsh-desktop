import assert from 'node:assert/strict'
import test from 'node:test'
import { primaryAction } from '../plugins/client/src/client/desktop/UpdateSetting.tsx'

test('maps updater phases to one primary action', () => {
  const currentVersion = '0.1.0-rc.5'
  assert.deepEqual(primaryAction({ phase: 'idle', currentVersion }), { kind: 'check', label: '检查更新' })
  assert.deepEqual(primaryAction({ phase: 'available', currentVersion, availableVersion: '0.1.0-rc.6' }), { kind: 'download', label: '下载更新' })
  assert.deepEqual(primaryAction({ phase: 'downloading', currentVersion, progressPercent: 47.7 }), { kind: 'disabled', label: '48%' })
  assert.deepEqual(primaryAction({ phase: 'downloaded', currentVersion, availableVersion: '0.1.0-rc.6' }), { kind: 'install', label: '重启并安装' })
  assert.deepEqual(primaryAction({ phase: 'unsupported', currentVersion }), { kind: 'releases', label: '下载安装包' })
})
