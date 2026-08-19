// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { packagedUpdateUnavailableReason, macAppProperlySigned } from './desktop-update.ts'

test('allows packaged macOS installs that carry app-update.yml', () => {
  assert.equal(packagedUpdateUnavailableReason({
    packaged: true,
    platform: 'darwin',
    appImage: false,
    hasUpdateConfig: true,
  }), undefined)
})

test('rejects directory installs that are missing app-update.yml', () => {
  assert.match(packagedUpdateUnavailableReason({
    packaged: true,
    platform: 'darwin',
    appImage: false,
    hasUpdateConfig: false,
  }) ?? '', /更新配置/)
})

test('rejects unpackaged development runs', () => {
  assert.match(packagedUpdateUnavailableReason({
    packaged: false,
    platform: 'darwin',
    appImage: false,
    hasUpdateConfig: false,
  }) ?? '', /开发版本/)
})

test('rejects adhoc-signed macOS installs that cannot apply Squirrel updates', () => {
  assert.match(packagedUpdateUnavailableReason({
    packaged: true,
    platform: 'darwin',
    appImage: false,
    hasUpdateConfig: true,
    properlySigned: false,
  }) ?? '', /Developer ID/)
})

test('macAppProperlySigned rejects adhoc signatures', () => {
  assert.equal(macAppProperlySigned(process.execPath), false)
})
