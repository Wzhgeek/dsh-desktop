/**
 * dsh-desktop client plugin — node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis tree and the client-modules
 * node half discovers `dsh.client.platform: web`; the browser half ships via
 * exports["./client"].
 * @module @dsh-desktop/client
 */

/** Host plugin body — no host-side behavior for this source plugin. */
export function apply(): void {}
