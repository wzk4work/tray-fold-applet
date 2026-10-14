#!/usr/bin/env python3
"""Opt-in smoke test on a running Cinnamon desktop with Tray Fold installed.

Creates temporary demo icons and temporarily changes Tray Fold selections.
Restores the selection and orientation in finally. Does not install the applet.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

UUID = 'tray-fold@kelvin'
MAIL = 'tray-fold-smoke-mail'
SYNC = 'tray-fold-smoke-sync'
LEGACY = 'tray-fold-smoke-legacy'


def icon_process(directory):
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('XApp', '1.0')
    from gi.repository import GLib, Gtk, XApp
    GLib.set_prgname(LEGACY)
    Gtk.init([])
    directory = Path(directory)

    def record(event, **values):
        with (directory / 'events.jsonl').open('a') as stream:
            stream.write(json.dumps({'event': event, **values}) + '\n')

    icons = []
    menus = []
    for name, image in [(MAIL, 'mail-unread'), (SYNC, 'folder-sync')]:
        icon = XApp.StatusIcon.new_with_name(name)
        icon.set_icon_name(image)
        icon.set_tooltip_text('Tray Fold demo: ' + name)
        icon.set_visible(True)
        icon.connect('button-press-event', lambda _icon, x, y, button, stamp, position:
                     record('press', button=button, x=x, y=y))
        icon.connect('button-release-event', lambda _icon, x, y, button, stamp, position:
                     record('release', button=button, x=x, y=y))
        menu = Gtk.Menu()
        menu.append(Gtk.MenuItem(label='Demo menu'))
        menu.show_all()
        menu.connect('show', lambda _menu: record('menu'))
        icon.set_secondary_menu(menu)
        menus.append(menu)
        icons.append(icon)
    legacy = Gtk.StatusIcon.new_from_icon_name('dialog-information')
    legacy.set_name(LEGACY)
    legacy.set_title('Tray Fold legacy demo')
    legacy.set_visible(True)
    last_command = None

    def commands():
        nonlocal last_command
        control = directory / 'command'
        if control.exists():
            command = control.read_text()
            if command != last_command:
                last_command = command
                if command == 'rename':
                    icons[0].set_name(MAIL + '-renamed')
                elif command == 'close-menu':
                    for menu in menus:
                        menu.popdown()
        return True

    GLib.timeout_add(100, commands)
    record('ready')
    Gtk.main()


def smoke(screenshot):
    import gi
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def call(method, signature, values, reply=None):
        return bus.call_sync('org.Cinnamon', '/org/Cinnamon', 'org.Cinnamon', method,
                             GLib.Variant(signature, values),
                             GLib.VariantType(reply) if reply else None,
                             Gio.DBusCallFlags.NONE, 10000, None)

    def evaluate(code):
        success, output = call('Eval', '(s)', [code], '(bs)').unpack()
        if not success:
            raise RuntimeError('Cinnamon Eval failed: ' + output)
        return json.loads(output) if output else None

    prefix = '''const a=imports.ui.appletManager.definitions.find(d=>d.uuid==="tray-fold@kelvin")?.applet;
    if(!a || !a._idleSources) return null;'''

    def app(code):
        return evaluate('(() => {' + prefix + code + '})()')

    def wait_for(predicate, message):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if predicate():
                print('PASS:', message, flush=True)
                return
            time.sleep(0.1)
        raise AssertionError(message)

    saved = app('return {hidden:a.hiddenRolesJson,orientation:a.orientation,open:a.popupOpen};')
    if saved is None:
        raise RuntimeError('Install and enable the current Tray Fold first')
    # Snapshot logs so pre-existing unrelated errors do not affect this run.
    error_log = Path.home() / '.xsession-errors'
    log_offset = error_log.stat().st_size if error_log.exists() else 0
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix='tray-fold-smoke-') as temp:
            directory = Path(temp)
            process = subprocess.Popen([sys.executable, __file__, '--icons', temp],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

            def events():
                log = directory / 'events.jsonl'
                return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

            wait_for(lambda: any(e['event'] == 'ready' for e in events()), 'demo process is ready')
            wait_for(lambda: app('return !!a.knownRoles[' + json.dumps(MAIL) + ']?.active && !!a.knownRoles[' +
                                  json.dumps(SYNC) + ']?.active;'), 'XApp icons detected')
            wait_for(lambda: app('return !!a.knownRoles[' + json.dumps(LEGACY) + ']?.active;'), 'legacy icon detected')
            app('a.hiddenRolesJson=' + json.dumps(json.dumps([MAIL, SYNC, LEGACY])) + '; a._onHiddenRolesSettingChanged(); return true;')
            wait_for(lambda: app('return a.xappIcons.size===2 && Object.keys(a.legacyIcons).length===1;'),
                     'two XApp icons and one legacy icon folded')
            app('a.on_orientation_changed(imports.gi.St.Side.BOTTOM); a._openPopup(); return true;')
            wait_for(lambda: app('return a.popupOpen && a.popupActor.visible && a.popupActor.width>0;'), 'popup is visible')
            if screenshot:
                # Only capture the demo popup, never the desktop or personal tray.
                app('a.on_orientation_changed('+str(saved['orientation'])+'); return true;')
                # Gtk's XEmbed contents arrive after the Cinnamon actor allocation.
                time.sleep(1.5)
                bounds = app('const b=imports.gi.Cinnamon.util_get_transformed_allocation(a.popupActor); return [Math.floor(b.x1),Math.floor(b.y1),Math.ceil(b.x2-b.x1),Math.ceil(b.y2-b.y1)];')
                output = Path(screenshot).resolve()
                output.parent.mkdir(parents=True, exist_ok=True)
                output.unlink(missing_ok=True)
                call('ScreenshotArea', '(biiiibs)', [False, *bounds, False, str(output)])
                wait_for(lambda: output.exists() and output.stat().st_size > 0, 'demo screenshot saved')

            for button in [1, 3]:
                app('const icon=[...a.xappIcons.values()].find(i=>i.proxy.name===' + json.dumps(MAIL) + ');'
                    'const event={get_button:()=>'+str(button)+',get_time:()=>global.get_current_time(),get_state:()=>0};'
                    'icon.onButtonPressEvent(icon.actor,event); icon.onButtonReleaseEvent(icon.actor,event); return true;')
                wait_for(lambda: any(e['event'] == 'press' and e.get('button') == button for e in events()),
                         'button ' + str(button) + ' press reached XApp over D-Bus')
                wait_for(lambda: any(e['event'] == 'release' and e.get('button') == button for e in events()),
                         'button ' + str(button) + ' release reached XApp over D-Bus')
            wait_for(lambda: any(e['event'] == 'menu' for e in events()), 'secondary GTK menu opened')
            (directory / 'command').write_text('close-menu')
            for side in ['TOP', 'LEFT', 'RIGHT', 'BOTTOM']:
                result = app('a.on_orientation_changed(imports.gi.St.Side.' + side + ');'
                             'return a.popupIconBox.vertical===([imports.gi.St.Side.LEFT,imports.gi.St.Side.RIGHT].includes(a.orientation));')
                assert result, side
                print('PASS: popup orientation', side, flush=True)
            (directory / 'command').write_text('rename')
            wait_for(lambda: app('return a.knownRoles['+json.dumps(MAIL)+']?.active===false && '
                                  '!!a.knownRoles['+json.dumps(MAIL+'-renamed')+']?.active;'), 'renamed role replaces old active role')
            app('a.hiddenRolesJson=' + json.dumps(json.dumps([MAIL+'-renamed', SYNC, LEGACY])) + ';a._onHiddenRolesSettingChanged();return true;')
            wait_for(lambda: app('return a.xappIcons.size===2;'), 'renamed icon folds again')
            app('a._closePopup(); return true;')
            process.terminate()
            process.wait(timeout=5)
            process = None
            wait_for(lambda: app('return a.xappIcons.size===0 && Object.keys(a.legacyIcons).length===0;'),
                     'application exit removes both kinds of folded icons')
            process = subprocess.Popen([sys.executable, __file__, '--icons', temp],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            # MAIL starts with its original name again; SYNC and legacy are saved.
            wait_for(lambda: app('return a.xappIcons.size===1 && Object.keys(a.legacyIcons).length===1;'),
                     'saved selections survive application restart')
            app('a.hiddenRolesJson="[]";a._onHiddenRolesSettingChanged();return true;')
            wait_for(lambda: app('return a.xappIcons.size===0 && Object.keys(a.legacyIcons).length===0 && a._replacementRoles.length===0;'),
                     'unfold restores icons to Cinnamon tray')
            assert app('global._trayFoldSmokeOld=a; a._queueIdle(()=>{throw new Error("callback survived removal")});'
                       'a.on_applet_removed_from_panel();return a._idleSources.size===0 && a.monitor===null && a.popupActor===null;')
            assert evaluate('global._trayFoldSmokeOld._removed')
            call('ReloadXlet', '(ss)', [UUID, 'APPLET'])
            wait_for(lambda: app('return a!==global._trayFoldSmokeOld && !a._removed;'), 'applet removal and reload release old resources')
            evaluate('delete global._trayFoldSmokeOld')
    finally:
        if process:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if not app('return !a._removed;'):
            call('ReloadXlet', '(ss)', [UUID, 'APPLET'])
            wait_for(lambda: app('return !a._removed;'), 'applet available for restoring settings')
        app('a.hiddenRolesJson='+json.dumps(saved['hidden'])+';a._onHiddenRolesSettingChanged();'
            'a.on_orientation_changed('+str(saved['orientation'])+');'+
            ('a._openPopup();' if saved['open'] else 'a._closePopup();')+'return true;')
        evaluate('delete global._trayFoldSmokeOld')
    if error_log.exists():
        with error_log.open() as stream:
            stream.seek(log_offset)
            logs = stream.read()
        related = [block for block in logs.split('\n\n') if 'JS ERROR' in block and
                   ('tray-fold@kelvin' in block or 'systray@cinnamon.org' in block)]
        if related:
            raise AssertionError('Desktop reported errors:\n'+'\n'.join(related))
    print('PASS: no new Tray Fold or systray JavaScript errors', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--screenshot', help='save a cropped demo popup PNG')
    parser.add_argument('--icons', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.icons:
        icon_process(args.icons)
    else:
        smoke(args.screenshot)
