const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Load the real applet with only the Cinnamon/GI boundary replaced. Runtime
// rendering and actual D-Bus interactions are covered by the desktop smoke test.
function loadApplet({ wayland = false } = {}) {
    const idle = new Map();
    const errors = [];
    let nextId = 1;
    const Main = {};
    const GLib = {
        get_home_dir: () => '/tmp/tray-fold-test',
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        idle_add: (_priority, callback) => {
            const id = nextId++;
            idle.set(id, callback);
            return id;
        },
        source_remove: id => idle.delete(id)
    };
    const St = {
        Side: { TOP: 0, BOTTOM: 1, LEFT: 2, RIGHT: 3 },
        IconType: { SYMBOLIC: 0, FULLCOLOR: 1 },
        Icon: class { constructor(props) { Object.assign(this, props); } },
        TextureCache: { get_default: () => ({ load_image_from_file_async: () => 7 }) }
    };
    const Clutter = { BUTTON_SECONDARY: 3, ModifierType: { CONTROL_MASK: 4 }, EVENT_STOP: 1, EVENT_PROPAGATE: 0 };
    const context = vm.createContext({
        imports: {
            ui: { applet: { IconApplet: class {} }, main: Main, tooltips: { Tooltip: function() {} } },
            gi: { GLib, St, Clutter, Meta: { is_wayland_compositor: () => wayland } },
            misc: {}, gettext: { bindtextdomain() {} }
        },
        global: { logError: message => errors.push(message) }
    });
    const source = fs.readFileSync(path.join(__dirname, '../tray-fold@kelvin/applet.js'), 'utf8');
    vm.runInContext(source + '\nglobalThis.exports = { TrayFoldApplet, FoldedXAppStatusIcon };', context);
    return { ...context.exports, Main, idle, errors, St, Clutter };
}

function bareApplet(TrayFoldApplet) {
    return Object.assign(Object.create(TrayFoldApplet.prototype), {
        _removed: false, _idleSources: new Set(), _replacementRoles: [],
        _updatingReplacementRoles: false, _xappSyncQueued: false,
        knownRoles: {}, xappIcons: new Map(), legacyIcons: {},
        _getRoleDisplayName: role => role,
        _getXAppDisplayName: (_proxy, role) => role,
        _isHiddenRole: () => false
    });
}

test('public replacement APIs normalize roles, preserve other applets, and handle synchronous signals', () => {
    const { TrayFoldApplet, Main } = loadApplet();
    const applet = bareApplet(TrayFoldApplet);
    const roles = [{ role: 'network', uuid: 'network@cinnamon.org' }];
    let changes = 0;
    Main.systrayManager = {
        get _roles() { throw new Error('private API must not be used'); },
        unregisterTrayIconReplacement(uuid) {
            for (let i = roles.length - 1; i >= 0; i--) if (roles[i].uuid === uuid) roles.splice(i, 1);
            changes++;
            applet._onSystrayRolesChanged();
        },
        registerTrayIconReplacement(role, uuid) {
            roles.push({ role, uuid });
            changes++;
            applet._onSystrayRolesChanged();
        }
    };
    applet._setTrayIconReplacementRoles([' Demo ', 'demo', '', 'MAIL']);
    assert.deepEqual(roles, [
        { role: 'network', uuid: 'network@cinnamon.org' },
        { role: 'demo', uuid: 'tray-fold@kelvin' },
        { role: 'mail', uuid: 'tray-fold@kelvin' }
    ]);
    applet._setTrayIconReplacementRoles(['mail', 'demo']);
    assert.equal(changes, 3, 'unchanged roles must not cause redisplays');
    applet._setTrayIconReplacementRoles([]);
    assert.deepEqual(roles, [{ role: 'network', uuid: 'network@cinnamon.org' }]);
    Main.systrayManager = null;
    assert.doesNotThrow(() => applet._setTrayIconReplacementRoles(['demo']));
});

test('removal cancels deferred work and releases resources before callbacks can run', () => {
    const { TrayFoldApplet, Main, idle } = loadApplet();
    const applet = bareApplet(TrayFoldApplet);
    let ran = 0;
    const cleaned = [];
    Object.assign(applet, {
        _signals: { disconnectAllSignals: () => cleaned.push('signals') },
        _closePopup: () => cleaned.push('popup'),
        _setTrayIconReplacementRoles: roles => { assert.equal(roles.length, 0); cleaned.push('roles'); },
        _clearXAppIcons: () => cleaned.push('xapp'),
        _clearLegacyIcons: () => cleaned.push('legacy'),
        monitor: {},
        popupActor: { destroy: () => cleaned.push('actor') },
        settings: { finalize: () => cleaned.push('settings') },
        _redisplayTrayIcons: () => cleaned.push('redisplay')
    });
    Main.layoutManager = { removeChrome() {} };
    applet._queueIdle(() => ran++);
    const staleCallback = [...idle.values()][0];
    assert.equal(idle.size, 1);
    applet.on_applet_removed_from_panel();
    assert.equal(idle.size, 0);
    assert.equal(applet._idleSources.size, 0);
    staleCallback();
    applet._queueIdle(() => ran++);
    assert.equal(ran, 0);
    assert.equal(idle.size, 0);
    assert.equal(applet.monitor, null);
    assert.equal(applet.popupActor, null);
    assert.equal(applet.settings, null);
    assert.deepEqual(cleaned, ['signals', 'popup', 'roles', 'xapp', 'legacy', 'actor', 'settings', 'redisplay']);
});

test('XApp resync clears renamed/stale roles but preserves state on monitor failure', () => {
    const { TrayFoldApplet, errors } = loadApplet();
    const applet = bareApplet(TrayFoldApplet);
    applet.knownRoles = {
        old: { source: 'XApp', active: true },
        legacy: { source: 'legacy', active: true }
    };
    applet._refreshTrayIconReplacementRoles = () => {};
    applet.monitor = { list_icons: () => [{ name: 'NEW', get_name: () => ':1.3', get_object_path: () => '/Icon' }] };
    applet._syncXAppIcons();
    assert.equal(applet.knownRoles.old.active, false);
    assert.equal(applet.knownRoles.new.active, true);
    assert.equal(applet.knownRoles.legacy.active, true);
    applet.monitor.list_icons = () => { throw new Error('monitor unavailable'); };
    applet._syncXAppIcons();
    assert.equal(applet.knownRoles.new.active, true);
    assert.equal(errors.length, 1);
});

test('obsolete image loads cannot replace a newer theme icon or touch a destroyed actor', () => {
    const { FoldedXAppStatusIcon, St } = loadApplet();
    const icon = Object.assign(Object.create(FoldedXAppStatusIcon.prototype), {
        applet: { getPanelIconSize: () => 24, _styleStatusIconActor() {} },
        actor: { vertical: false }, proxy: {},
        icon_holder: { show() {}, hide() {} }, _destroyed: false
    });
    icon.setIconName('/tmp/demo.png');
    const oldHandle = icon.iconLoaderHandle;
    icon.setIconName('mail-unread-symbolic');
    const themeIcon = icon.icon_holder.child;
    assert.equal(themeIcon.icon_type, St.IconType.SYMBOLIC);
    icon.onImageLoaded(null, oldHandle, { stale: true });
    assert.equal(icon.icon_holder.child, themeIcon);
    icon.setIconName('/tmp/another.png');
    icon._destroyed = true;
    icon.onImageLoaded(null, icon.iconLoaderHandle, { stale: true });
    assert.equal(icon.icon_holder.child, themeIcon);
    icon.label = { set_text(value) { this.text = value; } };
    icon.applet.orientation = St.Side.BOTTOM;
    icon.setLabel(null);
    assert.equal(icon.label.text, '');
    assert.equal(icon.label.visible, false);
});

test('legacy cleanup disconnects its handler and detaches the original tray actor', () => {
    const { TrayFoldApplet } = loadApplet();
    const applet = bareApplet(TrayFoldApplet);
    const actions = [];
    const original = { is_finalized: () => false, get_parent: () => wrapper, disconnect: id => actions.push(['disconnect', id]) };
    const wrapper = {
        is_finalized: () => false, get_parent: () => applet.popupIconBox,
        remove_actor: actor => { assert.equal(actor, original); actions.push(['detach']); },
        destroy: () => actions.push(['destroy-wrapper'])
    };
    applet.legacyIcons.demo = { icon: original, actor: wrapper, eventId: 4 };
    applet.popupIconBox = { remove_actor: actor => assert.equal(actor, wrapper) };
    applet._removeLegacyIcon('demo');
    assert.deepEqual(actions, [['disconnect', 4], ['detach'], ['destroy-wrapper']]);
    assert.equal(Object.keys(applet.legacyIcons).length, 0);
});

test('Wayland does not call the X11-only legacy dispatcher', () => {
    const { TrayFoldApplet, Main } = loadApplet({ wayland: true });
    Main.statusIconDispatcher = { redisplay() { throw new Error('X11-only'); } };
    assert.doesNotThrow(() => bareApplet(TrayFoldApplet)._redisplayTrayIcons());
});

test('legacy icon removal tolerates Cinnamon having already destroyed the wrapper', () => {
    const { TrayFoldApplet } = loadApplet();
    const applet = bareApplet(TrayFoldApplet);
    applet.legacyIcons.demo = {
        icon: { is_finalized: () => true }, actor: { is_finalized: () => true }, eventId: 4
    };
    assert.doesNotThrow(() => applet._removeLegacyIcon('demo'));
    assert.equal(Object.keys(applet.legacyIcons).length, 0);
});

test('primary and secondary clicks keep forwarding coordinates, button, and time to XApp', () => {
    const { FoldedXAppStatusIcon, Clutter } = loadApplet();
    const calls = [];
    const icon = Object.assign(Object.create(FoldedXAppStatusIcon.prototype), {
        _tooltip: { hide() {} }, getEventPositionInfo: () => [10, 20, 3],
        proxy: {
            call_button_press: (...args) => calls.push(['press', ...args]),
            call_button_release: (...args) => calls.push(['release', ...args])
        }
    });
    for (const button of [1, 3]) {
        const event = { get_button: () => button, get_time: () => 123, get_state: () => 0 };
        assert.equal(icon.onButtonPressEvent({}, event), Clutter.EVENT_STOP);
        assert.equal(icon.onButtonReleaseEvent({}, event), Clutter.EVENT_STOP);
    }
    assert.deepEqual(calls, [
        ['press', 10, 20, 1, 123, 3, null, null], ['release', 10, 20, 1, 123, 3, null, null],
        ['press', 10, 20, 3, 123, 3, null, null], ['release', 10, 20, 3, 123, 3, null, null]
    ]);
});
