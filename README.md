# Tray Fold Cinnamon Applet

`tray-fold@kelvin` folds selected Cinnamon tray icons into a popup, similar to the hidden tray icon area on Windows.

## Features

- Fold XApp StatusIcon tray items and legacy systray icons.
- Keep the original app interactions, including right-click menus.
- Prefer desktop application names in the configuration menu.
- Support Chinese and English UI strings.
- Follow the current Cinnamon panel colors for the popup surface.

## Layout

```text
tray-fold@kelvin/
  applet.js
  metadata.json
  settings-schema.json
  stylesheet.css
  po/zh_CN.po
```

## Install

From this repository:

```bash
./install.sh
```

Then reload the applet:

```bash
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon --method org.Cinnamon.ReloadXlet 'tray-fold@kelvin' 'APPLET'
```

If the applet is not already on the panel, add it through Cinnamon applet settings.

## Notes

The applet stores folded tray roles in Cinnamon applet settings. Internal role names are kept for matching, while display labels are resolved from desktop application metadata when possible.
