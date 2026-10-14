# Validation record

Validated on 2026-10-14 with Linux Mint 22.3, Cinnamon 6.6.9, and an X11 session. The applet's version is 0.1.0.

## Automated checks

Command: `./scripts/check.sh`

- Bash syntax checks for installation, uninstallation, and the check script.
- JavaScript syntax check and JSON parsing for metadata/settings.
- `msgfmt --check` for the Simplified Chinese catalog.
- Eight Node.js regression tests using the real source with mocked Cinnamon/GI boundaries: public replacement APIs and reentrant signals, cancellation of deferred work, stale/renamed XApp roles and monitor failure, obsolete image loads and null labels, legacy actor detachment, already-destroyed wrappers, skipping the legacy dispatcher on Wayland, and click forwarding.
- Python integration tests install into a temporary HOME with spaces in its path, update the installation, resolve real gettext translations, and uninstall twice. Other applets, other translation catalogs, and saved preferences remain intact. An invalid translation catalog must fail before changing an existing installation.

All checks passed locally. The GitHub Actions workflow uses the same command on pushes and pull requests. Hosted results are available in the repository's [Actions tab](https://github.com/wzk4work/tray-fold-applet/actions).

## Real desktop smoke test

Command: `python3 tests/smoke_desktop.py --screenshot docs/tray-fold-demo.png`

The final run exited successfully, with these checks passing:

| Behavior | Evidence |
| --- | --- |
| XApp and legacy detection | Temporary XApp icons and a Gtk.StatusIcon appeared as active roles. |
| Folding | Exactly two XApp icons and one legacy icon were present in the popup. |
| Popup display | Popup actor was visible and allocated on the real desktop. |
| Primary/secondary clicks | The applet's handlers sent button press/release events through actual XApp D-Bus proxies; the demo process recorded both buttons. |
| Right-click menu | The demo GTK secondary menu emitted its show signal. |
| Four directions | Direction callbacks correctly switched between horizontal and vertical popup layouts. |
| Role rename | The original role became inactive and the renamed role became active; selecting it folded the icon again. |
| Application exit/restart | Both icon types were removed on exit; saved choices folded them again after restart. |
| Unfolding | Clearing selections removed popup icons and replacement registrations, returning icons to the built-in tray. |
| Removal and reload | Deferred sources were cancelled, popup and monitor released, and a new applet instance loaded. |
| Error log | No new Tray Fold or built-in systray JavaScript errors appeared during the final run. |

The screenshot is a crop of the real popup with temporary demo icons. Original applet selections and orientation were restored after the smoke test. The installed files, translation catalog, and saved settings used for this temporary validation were then restored from backups.

## Scope and limits

The smoke test invokes click handlers programmatically; it verifies actual D-Bus delivery and menu behavior, not physical pointer hit testing. Direction checks exercise layout callbacks without moving the user's real panel. The screenshot uses the user's existing panel orientation. Other themes, scale factors, physical panel placements, Cinnamon versions, and Wayland have not been verified. The mocked Wayland test only proves that the applet avoids calling the X11-only legacy dispatcher.

Before extending the advertised support range, repeat the desktop smoke test in that environment and manually check pointer clicks, tooltips, menu placement, Escape/outside-click closing, theme switching, and panel placement. Run the desktop test only when temporary tray changes and an applet reload are acceptable; it does not run in CI.
