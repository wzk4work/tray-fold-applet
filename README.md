# Tray Fold Cinnamon Applet

[简体中文](README.zh-CN.md)

Fold selected Cinnamon tray icons into a popup, similar to the hidden tray icon area on Windows. Version **0.1.0** is an early release.

![Tray Fold popup with temporary demo icons](docs/tray-fold-demo.png)

## Features

- Fold XApp StatusIcon items and legacy X11 tray icons.
- Forward application clicks, right-click menus, and discrete scroll events.
- Select applications by their desktop names when available; keep selections across restarts.
- Chinese and English UI, theme-aware popup colors, and horizontal/vertical panels.

## Compatibility

Verified on **Linux Mint 22.3, Cinnamon 6.6.9, X11**. Keep Cinnamon's **XApp Status Applet** and **System Tray** enabled so unfolded icons have somewhere to appear. This applet is for Cinnamon, not GNOME Shell or KDE Plasma.

Other Cinnamon versions and Wayland have not been tested. On Wayland the applet skips the X11-only legacy tray dispatcher; this does not constitute verified Wayland support. XApp support also depends on the application and desktop's tray integration. Smooth scrolling is not forwarded.

## Install or update

Requirements: Cinnamon with XApp, Bash, `rsync`, and `msgfmt` (provided by `gettext`). On Linux Mint/Ubuntu:

```bash
sudo apt install rsync gettext
```

Download or clone this repository, open a terminal in its directory, and run **without sudo**:

```bash
./install.sh
```

The installer copies the applet to `~/.local/share/cinnamon/applets/tray-fold@kelvin`, compiles translations into `~/.local/share/locale`, and includes the license and attribution. Updating removes obsolete files within this applet's install directory. Cinnamon settings are retained.

Add **Tray Fold** through Cinnamon's **Applets** settings. For an already enabled applet, reload it:

```bash
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon --method org.Cinnamon.ReloadXlet 'tray-fold@kelvin' 'APPLET'
```

If translations or the new applet do not appear, log out and back in.

## Use

1. Right-click the fold button and open **Folded tray icons**.
2. Enable the switch for each application you want to fold. Turn it off to restore its icon to Cinnamon's regular tray.
3. Left-click the fold button to open the popup. Interact with icons as usual. Click outside or press **Esc** to close it.
4. Use **Reload tray icons** in the context menu if the list needs refreshing.

Applet settings let you show the button when empty and include the icon count in its tooltip. Saved inactive applications remain listed until you turn off their switch. Desktop names are used for display; internal roles identify applications. Applications that change their identity between launches may need to be selected again.

## Uninstall and recover

**Remove Tray Fold from the panel first** through Applets settings. Its removal releases tray replacements so icons return to the regular tray. Then run:

```bash
./uninstall.sh
```

This removes the applet and its compiled translations, while retaining saved settings for a later reinstall. To reset preferences completely, after removing the applet from the panel:

```bash
rm -rf -- "$HOME/.config/cinnamon/spices/tray-fold@kelvin"
```

If a regular tray icon remains missing, check that the built-in tray applets are enabled, then restart the affected application. Logging out and back in resets the desktop tray session.

## Development and validation

With Node.js 18+, Python 3, `rsync`, and `gettext` available:

```bash
./scripts/check.sh
```

Checks cover syntax, metadata, translations, lifecycle regressions, and an install/update/uninstall cycle in a temporary home directory. GitHub Actions runs these checks on pushes and pull requests.

An opt-in test using a real Cinnamon desktop is also provided:

```bash
# Install, enable, and reload this version first.
python3 tests/smoke_desktop.py
```

It requires PyGObject, Gtk 3, and XApp introspection bindings (`python3-gi`, `gir1.2-gtk-3.0`, `gir1.2-xapp-1.0` on Mint). It creates temporary tray icons, changes Tray Fold's selections and orientation, opens a demo menu, and reloads the applet. It restores the selections and orientation when finished. See [validation results and limits](docs/TESTING.md).

For bug reports, include your Cinnamon version, Linux distribution, X11/Wayland session, affected application's name, reproduction steps, and relevant Tray Fold errors from Looking Glass or `~/.xsession-errors`. Review logs for personal information before sharing them.

## License and attribution

GNU GPL **2.0 or later** (`GPL-2.0-or-later`); see [LICENSE](LICENSE). XApp rendering/event forwarding and legacy tray event handling include adaptations of Cinnamon's built-in applets. Upstream sources and copyright records are retained in [NOTICE](NOTICE).
