const Applet = imports.ui.applet;
const Clutter = imports.gi.Clutter;
const Cinnamon = imports.gi.Cinnamon;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const SignalManager = imports.misc.signalManager;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const XApp = imports.gi.XApp;

const UUID = "tray-fold@kelvin";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

const ZH_TRANSLATIONS = {
    "Tray Fold": "托盘折叠",
    "No hidden tray icons": "没有隐藏的托盘图标",
    "Folded tray icons": "已折叠的托盘图标",
    "Reload tray icons": "重新加载托盘图标",
    "Saved": "已保存",
    "No tray icons detected yet": "尚未检测到托盘图标",
    " (inactive)": "（未激活）",
    "legacy": "旧式"
};

function isChineseLocale() {
    return GLib.get_language_names().some((name) => {
        return String(name).toLowerCase().startsWith("zh");
    });
}

function _(str) {
    const translated = Gettext.dgettext(UUID, str);

    if (translated !== str) {
        return translated;
    }

    if (isChineseLocale() && str in ZH_TRANSLATIONS) {
        return ZH_TRANSLATIONS[str];
    }

    return str;
}

function normalizeRole(role) {
    if (!role) {
        return "";
    }

    return String(role).trim().toLowerCase();
}

function isTemporaryDbusRole(role) {
    return /^:\d+(?:\.\d+)+$/.test(normalizeRole(role));
}

function PopupIconTooltip(item, applet, initTitle) {
    this._init(item, applet, initTitle);
}

PopupIconTooltip.prototype = {
    __proto__: Tooltips.Tooltip.prototype,

    _init: function(item, applet, initTitle) {
        Tooltips.Tooltip.prototype._init.call(this, item, initTitle);
        this.applet = applet;
    },

    show: function() {
        if (this._tooltip.get_text() === "" || global.menuStack.length > 0 || !this.mousePosition) {
            return;
        }

        const op = this._tooltip.get_opacity();
        this._tooltip.set_opacity(0);
        this._tooltip.show();

        const monitor = Main.layoutManager.findMonitorForActor(this.item);
        const [, , tooltipWidth, tooltipHeight] = this._tooltip.get_preferred_size();
        const itemBox = Cinnamon.util_get_transformed_allocation(this.item);
        const popupBox = this.applet.popupActor ?
            Cinnamon.util_get_transformed_allocation(this.applet.popupActor) :
            itemBox;
        const gap = 6;

        let tooltipLeft = itemBox.x1 + ((itemBox.x2 - itemBox.x1) / 2) - (tooltipWidth / 2);
        let tooltipTop = popupBox.y1 - tooltipHeight - gap;

        switch (this.applet.orientation) {
            case St.Side.TOP:
                tooltipTop = popupBox.y2 + gap;
                break;
            case St.Side.LEFT:
                tooltipLeft = popupBox.x2 + gap;
                tooltipTop = itemBox.y1 + ((itemBox.y2 - itemBox.y1) / 2) - (tooltipHeight / 2);
                break;
            case St.Side.RIGHT:
                tooltipLeft = popupBox.x1 - tooltipWidth - gap;
                tooltipTop = itemBox.y1 + ((itemBox.y2 - itemBox.y1) / 2) - (tooltipHeight / 2);
                break;
            case St.Side.BOTTOM:
            default:
                break;
        }

        if (tooltipTop < monitor.y) {
            tooltipTop = popupBox.y2 + gap;
        } else if (tooltipTop + tooltipHeight > monitor.y + monitor.height) {
            tooltipTop = popupBox.y1 - tooltipHeight - gap;
        }

        if (tooltipLeft < monitor.x) {
            tooltipLeft = monitor.x;
        } else if (tooltipLeft + tooltipWidth > monitor.x + monitor.width) {
            tooltipLeft = monitor.x + monitor.width - tooltipWidth;
        }

        tooltipTop = Math.max(monitor.y, Math.min(tooltipTop, monitor.y + monitor.height - tooltipHeight));

        this._tooltip.set_position(Math.round(tooltipLeft), Math.round(tooltipTop));
        this._tooltip.set_opacity(op);
        this._tooltip.raise_top();
        this.visible = true;
    }
};

class FoldedXAppStatusIcon {
    constructor(applet, proxy) {
        this.applet = applet;
        this.proxy = proxy;
        this.name = proxy.name;
        this.iconName = null;

        this.actor = new St.BoxLayout({
            style_class: "tray-fold-popup-icon",
            reactive: !global.settings.get_boolean("panel-edit-mode"),
            track_hover: true,
            x_expand: true,
            y_expand: true
        });
        this.applet._stylePopupIconActor(this.actor);
        this._hoverChangedId = this.actor.connect("notify::hover", () => {
            this.applet._stylePopupIconActor(this.actor);
        });

        this.icon_holder = new St.Bin();
        this.label = new St.Label({ y_align: St.Align.END });
        this.actor.add_actor(this.icon_holder);
        this.actor.add_actor(this.label);

        this._tooltip = new PopupIconTooltip(this.actor, applet, "");
        this._proxyPropChangeId = this.proxy.connect("g-properties-changed", Lang.bind(this, this.onPropertiesChanged));

        this.actor.connect("button-press-event", Lang.bind(this, this.onButtonPressEvent));
        this.actor.connect("button-release-event", Lang.bind(this, this.onButtonReleaseEvent));
        this.actor.connect("scroll-event", Lang.bind(this, this.onScrollEvent));
        this.actor.connect("enter-event", Lang.bind(this, this.onEnterEvent));

        this.iconSize = this.applet.getPanelIconSize(St.IconType.FULLCOLOR);
        this.proxy.icon_size = this.iconSize;
        this.refresh();
    }

    onPropertiesChanged(proxy, changedProps) {
        const propNames = changedProps.deep_unpack();

        if ("IconName" in propNames) {
            this.setIconName(proxy.icon_name);
        }
        if ("TooltipText" in propNames) {
            this.setTooltipText(proxy.tooltip_text);
        }
        if ("Label" in propNames) {
            this.setLabel(proxy.label);
        }
        if ("Visible" in propNames) {
            this.setVisible(proxy.visible);
        }
        if ("PrimaryMenuIsOpen" in propNames && !proxy.primary_menu_is_open) {
            this.actor.sync_hover();
        }
        if ("SecondaryMenuIsOpen" in propNames && !proxy.secondary_menu_is_open) {
            this.actor.sync_hover();
        }
    }

    refresh() {
        this.setIconName(this.proxy.icon_name);
        this.setLabel(this.proxy.label);
        this.setTooltipText(this.proxy.tooltip_text);
        this.setVisible(this.proxy.visible);
        this.setOrientation(this.applet.orientation);
        this.actor.queue_relayout();
    }

    setOrientation(orientation) {
        if (orientation === St.Side.LEFT || orientation === St.Side.RIGHT) {
            this.actor.vertical = true;
            this.actor.add_style_class_name("vertical");
        } else {
            this.actor.vertical = false;
            this.actor.remove_style_class_name("vertical");
        }
    }

    setIconName(iconName) {
        if (!iconName) {
            this.iconName = null;
            this.iconSize = this.applet.getPanelIconSize(St.IconType.FULLCOLOR);
            this.proxy.icon_size = this.iconSize;
            this.icon_holder.hide();
            return;
        }

        let type = iconName.match(/symbolic/) ? St.IconType.SYMBOLIC : St.IconType.FULLCOLOR;
        let iconSize = this.applet.getPanelIconSize(type);
        this.iconName = iconName;
        this.iconSize = iconSize;
        this.proxy.icon_size = iconSize;

        if (iconName.includes("/") && type !== St.IconType.SYMBOLIC) {
            this.iconLoaderHandle = St.TextureCache.get_default().load_image_from_file_async(
                iconName,
                this.actor.vertical ? iconSize : -1,
                iconSize,
                (...args) => this.onImageLoaded(...args)
            );
        } else {
            this.icon_holder.child = new St.Icon({
                icon_type: type,
                icon_size: iconSize,
                icon_name: iconName,
                style_class: "tray-fold-status-icon"
            });
            this.applet._styleStatusIconActor(this.icon_holder.child);
            this.icon_holder.show();
        }
    }

    onImageLoaded(cache, handle, actor) {
        if (handle !== this.iconLoaderHandle) {
            return;
        }

        this.icon_holder.child = actor;
        this.applet._styleStatusIconActor(actor);
        this.icon_holder.show();
    }

    setLabel(label) {
        this.label.set_text(label || "");
        this.label.visible = (this.applet.orientation === St.Side.TOP || this.applet.orientation === St.Side.BOTTOM) &&
                             this.proxy.label.length > 0;
    }

    setTooltipText(tooltipText) {
        if (tooltipText) {
            this._tooltip.preventShow = false;
        } else {
            tooltipText = "";
            this._tooltip.preventShow = true;
        }

        this._tooltip.set_text(tooltipText);
    }

    setVisible(visible) {
        if (visible) {
            this.actor.show();
        } else {
            this.actor.hide();
        }
    }

    onEnterEvent() {
        this._tooltip.preventShow = false;
    }

    hideTooltip() {
        this._tooltip.hide();
    }

    getEventPositionInfo(actor) {
        const allocation = Cinnamon.util_get_transformed_allocation(actor);
        const x = Math.round(allocation.x1 / global.ui_scale);
        const y = Math.round(allocation.y1 / global.ui_scale);
        const w = Math.round((allocation.x2 - allocation.x1) / global.ui_scale);
        const h = Math.round((allocation.y2 - allocation.y1) / global.ui_scale);

        switch (this.applet.orientation) {
            case St.Side.TOP:
                return [x, y + h, Gtk.PositionType.TOP];
            case St.Side.LEFT:
                return [x + w, y, Gtk.PositionType.LEFT];
            case St.Side.RIGHT:
                return [x, y, Gtk.PositionType.RIGHT];
            case St.Side.BOTTOM:
            default:
                return [x, y, Gtk.PositionType.BOTTOM];
        }
    }

    onButtonPressEvent(actor, event) {
        this._tooltip.hide();
        this._tooltip.preventShow = true;

        if (event.get_button() === Clutter.BUTTON_SECONDARY &&
            event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
            return Clutter.EVENT_PROPAGATE;
        }

        const [x, y, orientation] = this.getEventPositionInfo(actor);
        this.proxy.call_button_press(x, y, event.get_button(), event.get_time(), orientation, null, null);

        return Clutter.EVENT_STOP;
    }

    onButtonReleaseEvent(actor, event) {
        const [x, y, orientation] = this.getEventPositionInfo(actor);
        this.proxy.call_button_release(x, y, event.get_button(), event.get_time(), orientation, null, null);

        return Clutter.EVENT_STOP;
    }

    onScrollEvent(actor, event) {
        const direction = event.get_scroll_direction();

        if (direction !== Clutter.ScrollDirection.SMOOTH) {
            let xappDirection = XApp.ScrollDirection.UP;
            let delta = 0;

            if (direction === Clutter.ScrollDirection.UP) {
                xappDirection = XApp.ScrollDirection.UP;
                delta = -1;
            } else if (direction === Clutter.ScrollDirection.DOWN) {
                xappDirection = XApp.ScrollDirection.DOWN;
                delta = 1;
            } else if (direction === Clutter.ScrollDirection.LEFT) {
                xappDirection = XApp.ScrollDirection.LEFT;
                delta = -1;
            } else if (direction === Clutter.ScrollDirection.RIGHT) {
                xappDirection = XApp.ScrollDirection.RIGHT;
                delta = 1;
            }

            this.proxy.call_scroll(delta, xappDirection, event.get_time(), null, null);
        }

        return Clutter.EVENT_STOP;
    }

    destroy() {
        if (this._proxyPropChangeId > 0) {
            this.proxy.disconnect(this._proxyPropChangeId);
            this._proxyPropChangeId = 0;
        }
        if (this._hoverChangedId > 0) {
            this.actor.disconnect(this._hoverChangedId);
            this._hoverChangedId = 0;
        }

        this._tooltip.destroy();
        this.actor.destroy();
    }
}

class TrayFoldApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.metadata = metadata;
        this.orientation = orientation;
        this.hiddenRoles = [];
        this.knownRoles = {};
        this.displayNameCache = {};
        this.appInfoCache = null;
        this.xappIcons = new Map();
        this.legacyIcons = {};
        this._signals = new SignalManager.SignalManager(null);
        this._suppressContextMenuRebuild = false;
        this._contextMenuDirty = false;
        this._xappSyncQueued = false;

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.set_applet_icon_symbolic_name("xsi-go-up");
        this.set_applet_tooltip(_("Tray Fold"));

        this.popupOpen = false;
        this._stageCaptureId = 0;
        this._buildPopup();
        this._buildContextMenu();

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind("show-empty", "showEmpty", this._updateAppletState);
        this.settings.bind("show-count", "showCount", this._updateAppletState);
        this.settings.bind("hidden-roles-json", "hiddenRolesJson", this._onHiddenRolesSettingChanged);

        this._parseHiddenRoles();
        this._applyHiddenRoles();
    }

    _buildPopup() {
        this.popupContent = new St.BoxLayout({
            vertical: true,
            style_class: "tray-fold-popup-content"
        });
        this.popupIconBox = new St.BoxLayout({
            vertical: false,
            style_class: "tray-fold-icon-box"
        });
        this.emptyLabel = new St.Label({
            text: _("No hidden tray icons"),
            style_class: "tray-fold-empty-label"
        });

        this.popupContent.add_actor(this.popupIconBox);
        this.popupContent.add_actor(this.emptyLabel);

        this.popupActor = new St.Bin({
            style_class: "tray-fold-popup-panel",
            reactive: true,
            track_hover: true,
            child: this.popupContent
        });
        Main.layoutManager.addChrome(this.popupActor, {
            visibleInFullscreen: true,
            affectsStruts: false,
            affectsInputRegion: true
        });
        this.popupActor.hide();
    }

    _buildContextMenu() {
        this.rolesMenuItem = new PopupMenu.PopupSubMenuMenuItem(_("Folded tray icons"));
        this._applet_context_menu.addMenuItem(this.rolesMenuItem);
        this._signals.connect(this._applet_context_menu, "open-state-changed", this._onContextMenuOpenStateChanged, this);

        this.reloadItem = new PopupMenu.PopupMenuItem(_("Reload tray icons"));
        this.reloadItem.connect("activate", Lang.bind(this, this._reloadTrayIcons));
        this._applet_context_menu.addMenuItem(this.reloadItem);
    }

    _onContextMenuOpenStateChanged(menu, open) {
        if (open || !this._contextMenuDirty) {
            return;
        }

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this._contextMenuIsOpen() && this._contextMenuDirty) {
                this._contextMenuDirty = false;
                this._rebuildContextMenu();
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    on_applet_added_to_panel() {
        this.monitor = new XApp.StatusIconMonitor();
        this._signals.connect(this.monitor, "icon-added", this._onXAppIconAdded, this);
        this._signals.connect(this.monitor, "icon-removed", this._onXAppIconRemoved, this);
        this._signals.connect(Main.systrayManager, "changed", this._onSystrayRolesChanged, this);
        this._signals.connect(Main.statusIconDispatcher, "status-icon-added", this._onLegacyIconAdded, this);
        this._signals.connect(Main.statusIconDispatcher, "status-icon-removed", this._onLegacyIconRemoved, this);
        this._signals.connect(Main.statusIconDispatcher, "before-redisplay", this._onBeforeLegacyRedisplay, this);
        this._signals.connect(global.settings, "changed::panel-edit-mode", this._onPanelEditModeChanged, this);
        this._signals.connect(global, "scale-changed", this._refreshAllIcons, this);
        this._signals.connect(Main.themeManager, "theme-set", this._applyPopupThemeStyle, this);

        this._applyPopupThemeStyle();
        this._applyHiddenRoles();
        this._loadExistingXAppIcons();
        this._redisplayTrayIcons();
    }

    on_applet_removed_from_panel() {
        this._signals.disconnectAllSignals();
        this._closePopup();
        this._setTrayIconReplacementRoles([]);

        this._clearXAppIcons();
        this._clearLegacyIcons();

        if (this.popupActor) {
            Main.layoutManager.removeChrome(this.popupActor);
            this.popupActor.destroy();
            this.popupActor = null;
        }

        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }

        this._redisplayTrayIcons();
    }

    on_orientation_changed(orientation) {
        this.orientation = orientation;
        this.popupIconBox.vertical = orientation === St.Side.LEFT || orientation === St.Side.RIGHT;

        for (let icon of this.xappIcons.values()) {
            icon.setOrientation(orientation);
        }

        this._syncPopupPosition();
    }

    on_panel_icon_size_changed() {
        this._refreshAllIcons();
        this._syncPopupPosition();
    }

    on_applet_clicked() {
        this._updateAppletState();
        this._togglePopup();
    }

    _togglePopup() {
        if (this.popupOpen) {
            this._closePopup();
        } else {
            this._openPopup();
        }
    }

    _openPopup() {
        if (!this.popupActor || this.popupOpen) {
            return;
        }

        this.popupOpen = true;
        this._applyPopupThemeStyle();
        this.popupActor.show();
        Main.uiGroup.set_child_above_sibling(this.popupActor, null);
        this._syncPopupPosition();

        if (this._stageCaptureId === 0) {
            this._stageCaptureId = global.stage.connect("captured-event", Lang.bind(this, this._onStageCapturedEvent));
        }
    }

    _closePopup() {
        if (!this.popupOpen && this._stageCaptureId === 0) {
            return;
        }

        this.popupOpen = false;

        for (let icon of this.xappIcons.values()) {
            icon.hideTooltip();
        }

        if (this.popupActor) {
            this.popupActor.hide();
        }

        if (this._stageCaptureId > 0) {
            global.stage.disconnect(this._stageCaptureId);
            this._stageCaptureId = 0;
        }
    }

    _onStageCapturedEvent(actor, event) {
        const eventType = event.type();

        if (eventType === Clutter.EventType.KEY_PRESS &&
            event.get_key_symbol() === Clutter.KEY_Escape) {
            this._closePopup();
            return Clutter.EVENT_STOP;
        }

        if (eventType !== Clutter.EventType.BUTTON_PRESS &&
            eventType !== Clutter.EventType.TOUCH_BEGIN) {
            return Clutter.EVENT_PROPAGATE;
        }

        const source = event.get_source();

        if (!source || source.is_finalized()) {
            return Clutter.EVENT_PROPAGATE;
        }

        if ((this.popupActor && this.popupActor.contains(source)) ||
            (this.actor && this.actor.contains(source))) {
            return Clutter.EVENT_PROPAGATE;
        }

        this._closePopup();
        return Clutter.EVENT_PROPAGATE;
    }

    _syncPopupPosition() {
        if (!this.popupActor || !this.popupOpen || !this.actor || this.actor.get_stage() === null) {
            return;
        }

        const sourceBox = Cinnamon.util_get_transformed_allocation(this.actor);
        const [, , naturalWidth, naturalHeight] = this.popupActor.get_preferred_size();
        const monitor = Main.layoutManager.findMonitorForActor(this.actor);
        const x1 = monitor.x;
        const x2 = monitor.x + monitor.width;
        const y1 = monitor.y;
        const y2 = monitor.y + monitor.height;

        let x = sourceBox.x1 + ((sourceBox.x2 - sourceBox.x1) / 2) - (naturalWidth / 2);
        let y = sourceBox.y1 - naturalHeight;

        if (this.orientation === St.Side.TOP) {
            y = sourceBox.y2;
        } else if (this.orientation === St.Side.LEFT) {
            x = sourceBox.x2;
            y = sourceBox.y1;
        } else if (this.orientation === St.Side.RIGHT) {
            x = sourceBox.x1 - naturalWidth;
            y = sourceBox.y1;
        }

        x = Math.max(x1, Math.min(Math.round(x), x2 - naturalWidth));
        y = Math.max(y1, Math.min(Math.round(y), y2 - naturalHeight));

        this.popupActor.set_position(x, y);
        Main.layoutManager.updateChrome();
    }

    _colorToCss(color, alphaOverride = null) {
        const alpha = alphaOverride !== null ? alphaOverride : color.alpha / 255;
        return `rgba(${color.red}, ${color.green}, ${color.blue}, ${Math.max(0, Math.min(alpha, 1))})`;
    }

    _getActorColors(actor) {
        const node = actor.get_theme_node();
        return {
            background: node.get_background_color(),
            foreground: node.get_foreground_color()
        };
    }

    _getPopupThemeColors() {
        const fallbackBackground = new Clutter.Color({ red: 31, green: 31, blue: 31, alpha: 235 });
        const fallbackForeground = new Clutter.Color({ red: 255, green: 255, blue: 255, alpha: 255 });
        const candidates = [];

        if (this.panel && this.panel.actor) {
            candidates.push(this.panel.actor);
        }

        let actor = this.actor;

        while (actor) {
            candidates.push(actor);
            actor = actor.get_parent ? actor.get_parent() : null;
        }

        let background = null;
        let foreground = null;

        for (let candidate of candidates) {
            if (!candidate || candidate.is_finalized && candidate.is_finalized()) {
                continue;
            }

            const colors = this._getActorColors(candidate);

            if (!background && colors.background && colors.background.alpha > 0) {
                background = colors.background;
            }
            if (!foreground && colors.foreground && colors.foreground.alpha > 0) {
                foreground = colors.foreground;
            }
            if (background && foreground) {
                break;
            }
        }

        return {
            background: background || fallbackBackground,
            foreground: foreground || fallbackForeground
        };
    }

    _popupIconStyle() {
        const { foreground } = this._getPopupThemeColors();
        const hoverColor = this._colorToCss(foreground, 0.15);
        const color = this._colorToCss(foreground);

        return {
            normal: `padding: 4px; border-radius: 4px; color: ${color}; spacing: 2px;`,
            hover: `padding: 4px; border-radius: 4px; color: ${color}; spacing: 2px; background-color: ${hoverColor};`,
            icon: `color: ${color};`
        };
    }

    _stylePopupIconActor(actor) {
        if (!actor || actor.is_finalized && actor.is_finalized()) {
            return;
        }

        const style = this._popupIconStyle();
        actor.set_style(actor.hover ? style.hover : style.normal);
    }

    _styleStatusIconActor(actor) {
        if (!actor || actor.is_finalized && actor.is_finalized() || !actor.set_style) {
            return;
        }

        actor.set_style(this._popupIconStyle().icon);
    }

    _applyPopupThemeStyle() {
        if (!this.popupActor) {
            return;
        }

        const { background, foreground } = this._getPopupThemeColors();
        const backgroundCss = this._colorToCss(background);
        const foregroundCss = this._colorToCss(foreground);
        const mutedForegroundCss = this._colorToCss(foreground, 0.65);

        this.popupActor.set_style(`padding: 8px; border-radius: 8px; color: ${foregroundCss}; background-color: ${backgroundCss}; box-shadow: 0 0 5px rgba(0, 0, 0, 0.5), 0 0 16px rgba(0, 0, 0, 0.24);`);
        this.popupContent.set_style("spacing: 6px;");
        this.popupIconBox.set_style("spacing: 4px;");
        this.emptyLabel.set_style(`padding: 6px 10px; color: ${mutedForegroundCss};`);

        for (let icon of this.xappIcons.values()) {
            this._stylePopupIconActor(icon.actor);
            this._styleStatusIconActor(icon.icon_holder.child);
        }

        for (let role in this.legacyIcons) {
            this._stylePopupIconActor(this.legacyIcons[role].actor);
        }
    }

    _onPanelEditModeChanged() {
        const reactive = !global.settings.get_boolean("panel-edit-mode");

        for (let icon of this.xappIcons.values()) {
            icon.actor.reactive = reactive;
        }

        for (let role in this.legacyIcons) {
            this.legacyIcons[role].actor.reactive = reactive;
        }
    }

    _onHiddenRolesSettingChanged() {
        this._parseHiddenRoles();
        this._applyHiddenRoles();
    }

    _getPersistentKey(role) {
        role = normalizeRole(role);

        if (!role) {
            return "";
        }

        if (!this.persistentKeyCache) {
            this.persistentKeyCache = {};
        }

        if (this.persistentKeyCache[role]) {
            return this.persistentKeyCache[role];
        }

        let pid = role.startsWith(":") ? this._getConnectionPid(role) : 0;
        if (pid === 0) {
            const match = role.match(/statusnotifieritem-(\d+)-\d+/i);
            if (match) {
                pid = parseInt(match[1], 10);
            }
        }

        let key = "";
        if (pid > 0) {
            const desktopFile = this._getDesktopFileFromProcess(pid);
            if (desktopFile) {
                key = GLib.path_get_basename(desktopFile).replace(/\.desktop$/, "");
            }
            if (!key) {
                key = this._getProcessName(pid);
            }
        }

        if (!key) {
            const appName = this._getDesktopAppDisplayName(role);
            if (appName) {
                key = this._normalizeAppKey(appName);
            } else {
                key = role;
            }
        }

        key = normalizeRole(key);
        this.persistentKeyCache[role] = key;
        return key;
    }

    _parseHiddenRoles() {
        try {
            const parsed = JSON.parse(this.hiddenRolesJson || "[]");

            if (!Array.isArray(parsed)) {
                this.hiddenRoles = [];
                return;
            }

            this.hiddenRoles = [];
            let shouldSave = false;

            for (let role of parsed) {
                const normalizedRole = normalizeRole(role);
                const key = this._getPersistentKey(role);

                if (!key || isTemporaryDbusRole(key)) {
                    shouldSave = true;
                    continue;
                }

                if (key !== normalizedRole) {
                    shouldSave = true;
                }

                // Filter out stale dynamic roles
                if (key.includes("statusnotifieritem-")) {
                    const match = key.match(/statusnotifieritem-(\d+)-\d+/i);
                    if (match) {
                        const testPid = parseInt(match[1], 10);
                        if (!GLib.file_test(`/proc/${testPid}`, GLib.FileTest.EXISTS)) {
                            shouldSave = true;
                            continue;
                        }
                    }
                }

                if (this.hiddenRoles.includes(key)) {
                    shouldSave = true;
                } else {
                    this.hiddenRoles.push(key);
                }
            }

            if (shouldSave) {
                this._saveHiddenRoles();
            }
        } catch (e) {
            global.logError(`${UUID}: unable to parse hidden role list: ${e}`);
            this.hiddenRoles = [];
        }
    }

    _saveHiddenRoles() {
        this.hiddenRoles = this.hiddenRoles.filter((key, index, keys) => {
            return key && !isTemporaryDbusRole(key) && keys.indexOf(key) === index;
        });
        this.hiddenRolesJson = JSON.stringify(this.hiddenRoles);
    }

    _refreshTrayIconReplacementRoles() {
        const activeRolesToHide = [];

        for (let role of Object.keys(this.knownRoles)) {
            const info = this.knownRoles[role];
            if (info && info.active && this._isHiddenRole(role)) {
                activeRolesToHide.push(role);
            }
        }

        this._setTrayIconReplacementRoles(activeRolesToHide);
    }

    _applyHiddenRoles(rebuildContextMenu = true) {
        for (let key of this.hiddenRoles) {
            if (!this.knownRoles[key]) {
                this._markRole(key, _("Saved"), false);
            }
        }

        this._suppressContextMenuRebuild = !rebuildContextMenu;

        try {
            this._refreshTrayIconReplacementRoles();
        } finally {
            this._suppressContextMenuRebuild = false;
        }

        this._syncXAppIcons();

        if (rebuildContextMenu) {
            this._maybeRebuildContextMenu();
        }

        this._updateAppletState();
    }

    _setTrayIconReplacementRoles(roles) {
        if (!Main.systrayManager || !Main.systrayManager._roles) {
            Main.systrayManager.unregisterTrayIconReplacement(UUID);

            for (let role of roles) {
                Main.systrayManager.registerTrayIconReplacement(role, UUID);
            }

            return;
        }

        const normalizedRoles = [];

        for (let role of roles) {
            role = normalizeRole(role);

            if (role && !normalizedRoles.includes(role)) {
                normalizedRoles.push(role);
            }
        }

        const oldRoles = Main.systrayManager._roles
            .filter((item) => item.uuid === UUID)
            .map((item) => item.role)
            .sort();
        const newRoles = normalizedRoles.slice().sort();

        if (JSON.stringify(oldRoles) === JSON.stringify(newRoles)) {
            return;
        }

        Main.systrayManager._roles = Main.systrayManager._roles.filter((item) => item.uuid !== UUID);

        for (let role of normalizedRoles) {
            Main.systrayManager._roles.push({ role, uuid: UUID });
        }

        Main.systrayManager.emit("changed");
    }

    _isHiddenRole(role) {
        return this.hiddenRoles.includes(this._getPersistentKey(role));
    }

    _toggleRole(role, rebuildContextMenu = true) {
        const key = this._getPersistentKey(role);

        if (!key || isTemporaryDbusRole(key)) {
            return;
        }

        const index = this.hiddenRoles.indexOf(key);
        if (index >= 0) {
            this.hiddenRoles.splice(index, 1);
        } else {
            this.hiddenRoles.push(key);
        }

        this._saveHiddenRoles();
        this._applyHiddenRoles(rebuildContextMenu);
    }

    _markRole(role, source, active, displayName = null) {
        role = normalizeRole(role);

        if (!role) {
            return;
        }

        displayName = displayName || this._getRoleDisplayName(role);

        if (!this.knownRoles[role]) {
            this.knownRoles[role] = {
                role,
                source,
                active: !!active,
                displayName: displayName || role
            };
        } else {
            this.knownRoles[role].source = source || this.knownRoles[role].source;
            this.knownRoles[role].active = !!active;
            this.knownRoles[role].displayName = displayName || this.knownRoles[role].displayName || role;
        }
    }

    _bytesToString(bytes) {
        let chars = [];

        for (let i = 0; i < bytes.length; i++) {
            chars.push(String.fromCharCode(bytes[i]));
        }

        return chars.join("");
    }

    _getConnectionPid(connectionName) {
        if (!connectionName || !String(connectionName).startsWith(":")) {
            return 0;
        }

        try {
            const result = Gio.DBus.session.call_sync(
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus",
                "GetConnectionUnixProcessID",
                new GLib.Variant("(s)", [connectionName]),
                new GLib.VariantType("(u)"),
                Gio.DBusCallFlags.NONE,
                500,
                null
            );

            return result.deep_unpack()[0];
        } catch (e) {
            return 0;
        }
    }

    _getDesktopFileFromProcess(pid) {
        try {
            const [ok, contents] = GLib.file_get_contents(`/proc/${pid}/environ`);

            if (!ok) {
                return "";
            }

            const env = this._bytesToString(contents).split("\0");
            const keys = ["GIO_LAUNCHED_DESKTOP_FILE", "DESKTOP_FILE"];

            for (let key of keys) {
                const prefix = `${key}=`;
                const entry = env.find((item) => item.startsWith(prefix));

                if (!entry) {
                    continue;
                }

                const value = entry.slice(prefix.length);

                if (value.startsWith("/")) {
                    return value;
                }

                const candidates = [
                    GLib.build_filenamev([GLib.get_home_dir(), ".local", "share", "applications", value]),
                    GLib.build_filenamev(["/usr/share/applications", value])
                ];

                for (let candidate of candidates) {
                    if (GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
                        return candidate;
                    }
                }
            }
        } catch (e) {
        }

        return "";
    }

    _getProcessName(pid) {
        try {
            const [ok, contents] = GLib.file_get_contents(`/proc/${pid}/comm`);

            if (ok) {
                return this._bytesToString(contents).trim();
            }
        } catch (e) {
        }

        return "";
    }

    _normalizeAppKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/\.desktop$/, "")
            .replace(/\.py$/, "")
            .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
    }

    _commandBasename(command) {
        command = String(command || "").trim().replace(/^["']|["']$/g, "");

        if (!command) {
            return "";
        }

        return GLib.path_get_basename(command.split(/\s+/)[0]).replace(/^["']|["']$/g, "");
    }

    _getRoleAppCandidates(role) {
        role = String(role || "").trim();

        const candidates = [
            role,
            role.replace(/\.py$/i, ""),
            role.replace(/_/g, "-"),
            role.replace(/-/g, "_"),
            role.replace(/\s+/g, "-")
        ];
        const normalized = [];

        for (let candidate of candidates) {
            const key = this._normalizeAppKey(candidate);

            if (key && !normalized.includes(key)) {
                normalized.push(key);
            }
        }

        return normalized;
    }

    _getAppInfoCache() {
        if (this.appInfoCache) {
            return this.appInfoCache;
        }

        this.appInfoCache = [];

        try {
            for (let app of Gio.AppInfo.get_all()) {
                const id = app.get_id ? (app.get_id() || "") : "";
                const name = app.get_name ? (app.get_name() || "") : "";
                const executable = app.get_executable ? (app.get_executable() || "") : "";
                const execBase = this._commandBasename(executable);

                this.appInfoCache.push({
                    id,
                    name,
                    executable,
                    idKey: this._normalizeAppKey(id),
                    idBaseKey: this._normalizeAppKey(id.replace(/\.desktop$/, "")),
                    nameKey: this._normalizeAppKey(name),
                    execKey: this._normalizeAppKey(execBase)
                });
            }
        } catch (e) {
            global.logError(`${UUID}: unable to read desktop application list: ${e}`);
        }

        return this.appInfoCache;
    }

    _scoreAppInfo(app, roleKeys) {
        let score = 0;

        for (let roleKey of roleKeys) {
            if (!roleKey) {
                continue;
            }

            if (app.idBaseKey === roleKey || app.idKey === roleKey) {
                score = Math.max(score, 100);
            }
            if (app.execKey === roleKey) {
                score = Math.max(score, 96);
            }
            if (app.nameKey === roleKey) {
                score = Math.max(score, 90);
            }
            if (roleKey.length >= 4 && (app.idKey.endsWith(roleKey) || app.idBaseKey.endsWith(roleKey))) {
                score = Math.max(score, 86);
            }
            if (roleKey.length >= 4 && app.execKey && (app.execKey.startsWith(roleKey) || roleKey.startsWith(app.execKey))) {
                score = Math.max(score, 82);
            }
            if (roleKey.length >= 4 && app.idKey.includes(roleKey)) {
                score = Math.max(score, 76);
            }
            if (roleKey.length >= 3 && app.nameKey.includes(roleKey)) {
                score = Math.max(score, 72);
            }
        }

        const id = String(app.id || "").toLowerCase();

        if (id.includes("handler")) {
            score -= 20;
        }
        if (id.includes("tray")) {
            score -= 8;
        }
        if (id.includes("kde")) {
            score -= 5;
        }
        if (id.includes("adapters")) {
            score -= 5;
        }
        if (id.includes("manager")) {
            score += 2;
        }

        return score;
    }

    _getDesktopAppDisplayName(role) {
        const roleKeys = this._getRoleAppCandidates(role);
        let bestApp = null;
        let bestScore = 0;

        for (let app of this._getAppInfoCache()) {
            const score = this._scoreAppInfo(app, roleKeys);

            if (score > bestScore) {
                bestApp = app;
                bestScore = score;
            }
        }

        if (bestApp && bestScore >= 70 && bestApp.name) {
            return bestApp.name;
        }

        return "";
    }

    _getRoleDisplayName(role) {
        role = normalizeRole(role);

        if (!role) {
            return "";
        }

        if (this.displayNameCache[role]) {
            return this.displayNameCache[role];
        }

        const appName = this._getDesktopAppDisplayName(role);

        if (appName) {
            this.displayNameCache[role] = appName;
            return appName;
        }

        let pid = role.startsWith(":") ? this._getConnectionPid(role) : 0;
        if (pid === 0) {
            const match = role.match(/statusnotifieritem-(\d+)-\d+/i);
            if (match) {
                pid = parseInt(match[1], 10);
            }
        }

        if (pid > 0) {
            const desktopFile = this._getDesktopFileFromProcess(pid);

            if (desktopFile) {
                const appInfo = Gio.DesktopAppInfo.new_from_filename(desktopFile);

                if (appInfo && appInfo.get_name()) {
                    this.displayNameCache[role] = appInfo.get_name();
                    return this.displayNameCache[role];
                }
            }

            const processName = this._getProcessName(pid);

            if (processName && processName.toLowerCase() !== "xdg-dbus-proxy") {
                this.displayNameCache[role] = processName;
                return processName;
            }
        }

        this.displayNameCache[role] = role;
        return role;
    }

    _contextMenuIsOpen() {
        return (this._applet_context_menu && this._applet_context_menu.isOpen) ||
               (this.rolesMenuItem && this.rolesMenuItem.menu && this.rolesMenuItem.menu.isOpen);
    }

    _maybeRebuildContextMenu() {
        if (this._suppressContextMenuRebuild || this._contextMenuIsOpen()) {
            this._contextMenuDirty = true;
            return;
        }

        this._contextMenuDirty = false;
        this._rebuildContextMenu();
    }

    _shouldShowRoleInContextMenu(role) {
        const info = this.knownRoles[role];

        return !!(info && (info.active || this._isHiddenRole(role)));
    }

    _rebuildContextMenuSoon() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._contextMenuDirty = false;
            this._rebuildContextMenu();

            return GLib.SOURCE_REMOVE;
        });
    }

    _getGroupedRoles() {
        const groups = {};

        for (let role of Object.keys(this.knownRoles)) {
            const info = this.knownRoles[role];
            if (!info) continue;

            const key = this._getPersistentKey(role);

            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    displayName: info.displayName || key,
                    active: false,
                    roles: []
                };
            }

            groups[key].roles.push(role);
            if (info.active) {
                groups[key].active = true;
                if (info.displayName && info.displayName !== role) {
                    groups[key].displayName = info.displayName;
                }
            }
        }

        return groups;
    }

    _rebuildContextMenu() {
        if (!this.rolesMenuItem) {
            return;
        }

        this.rolesMenuItem.menu.removeAll();

        for (let key of this.hiddenRoles) {
            if (!this.knownRoles[key]) {
                this._markRole(key, _("Saved"), false);
            }
        }

        const groups = this._getGroupedRoles();

        const groupKeys = Object.keys(groups).filter((key) => {
            const group = groups[key];
            const name = (group.displayName || key).trim().toLowerCase();
            if (name.startsWith("org.kde.statusnotifieritem") ||
                name.includes("statusnotifieritem") ||
                name.startsWith(":") ||
                name === "xdg-dbus-proxy") {
                return false;
            }
            return group.active || this.hiddenRoles.includes(key);
        }).sort((a, b) => {
            const aGroup = groups[a];
            const bGroup = groups[b];

            if (aGroup.active !== bGroup.active) {
                return aGroup.active ? -1 : 1;
            }

            return GLib.utf8_collate(aGroup.displayName || a, bGroup.displayName || b);
        });

        if (groupKeys.length === 0) {
            const item = new PopupMenu.PopupMenuItem(_("No tray icons detected yet"));
            item.setSensitive(false);
            this.rolesMenuItem.menu.addMenuItem(item);
            return;
        }

        for (let key of groupKeys) {
            const group = groups[key];
            const suffix = group.active ? "" : _(" (inactive)");
            const item = new PopupMenu.PopupSwitchMenuItem((group.displayName || key) + suffix, this.hiddenRoles.includes(key));

            item.connect("toggled", () => {
                const index = this.hiddenRoles.indexOf(key);
                if (index >= 0) {
                    this.hiddenRoles.splice(index, 1);
                } else {
                    this.hiddenRoles.push(key);
                }

                this._saveHiddenRoles();
                this._applyHiddenRoles(false);

                if (!group.active && !this.hiddenRoles.includes(key)) {
                    this._rebuildContextMenuSoon();
                }
            });

            this.rolesMenuItem.menu.addMenuItem(item);
        }
    }

    _activeHiddenCount() {
        return this.xappIcons.size + Object.keys(this.legacyIcons).length;
    }

    _updateAppletState() {
        const count = this._activeHiddenCount();
        this.emptyLabel.visible = count === 0;
        this.popupIconBox.visible = count > 0;

        if (this.showCount) {
            this.set_applet_tooltip(`${_("Tray Fold")} (${count})`);
        } else {
            this.set_applet_tooltip(_("Tray Fold"));
        }

        if (this.showEmpty || count > 0) {
            this.actor.show();
        } else {
            this._closePopup();
            this.actor.hide();
        }

        this._syncPopupPosition();
    }

    _loadExistingXAppIcons() {
        if (!this.monitor) {
            return;
        }

        try {
            for (let proxy of this.monitor.list_icons()) {
                this._onXAppIconAdded(this.monitor, proxy);
            }
        } catch (e) {
            global.logError(`${UUID}: unable to list XApp status icons: ${e}`);
        }
    }

    _getXAppKey(proxy) {
        return proxy.get_name() + proxy.get_object_path();
    }

    _getXAppRole(proxy) {
        return normalizeRole(proxy.name);
    }

    _getXAppDisplayName(proxy, role) {
        return this._getRoleDisplayName(role);
    }

    _trackXAppProxy(proxy) {
        this._signals.connect(proxy, "g-properties-changed", this._onXAppProxyPropertiesChanged, this);
    }

    _untrackXAppProxy(proxy) {
        this._signals.disconnect("g-properties-changed", proxy, this._onXAppProxyPropertiesChanged);
    }

    _onXAppProxyPropertiesChanged(proxy, changedProps) {
        const propNames = changedProps.deep_unpack();

        if ("Name" in propNames) {
            this._queueXAppSync();
        }
    }

    _queueXAppSync() {
        if (this._xappSyncQueued) {
            return;
        }

        this._xappSyncQueued = true;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._xappSyncQueued = false;
            this._syncXAppIcons();
            this._refreshTrayIconReplacementRoles();
            this._maybeRebuildContextMenu();
            this._updateAppletState();

            return GLib.SOURCE_REMOVE;
        });
    }

    _onXAppIconAdded(monitor, proxy) {
        this._trackXAppProxy(proxy);

        const role = this._getXAppRole(proxy);

        if (role) {
            this._markRole(role, "XApp", true, this._getXAppDisplayName(proxy, role));
        }

        if (this._isHiddenRole(role)) {
            this._addXAppIcon(proxy);
        }

        this._refreshTrayIconReplacementRoles();
        this._maybeRebuildContextMenu();
        this._updateAppletState();
    }

    _onXAppIconRemoved(monitor, proxy) {
        const role = this._getXAppRole(proxy);
        this._untrackXAppProxy(proxy);

        if (role) {
            this._markRole(role, "XApp", false);
        }

        this._removeXAppIcon(proxy);
        this._refreshTrayIconReplacementRoles();
        this._maybeRebuildContextMenu();
        this._updateAppletState();
    }

    _syncXAppIcons() {
        if (!this.monitor) {
            return;
        }

        let activeKeys = [];

        try {
            for (let proxy of this.monitor.list_icons()) {
                const key = this._getXAppKey(proxy);
                const role = this._getXAppRole(proxy);
                activeKeys.push(key);

                if (role) {
                    this._markRole(role, "XApp", true, this._getXAppDisplayName(proxy, role));
                }

                if (role && this._isHiddenRole(role)) {
                    this._addXAppIcon(proxy);
                } else {
                    this._removeXAppIcon(proxy);
                }
            }
        } catch (e) {
            global.logError(`${UUID}: unable to sync XApp status icons: ${e}`);
        }

        for (let [key, icon] of this.xappIcons) {
            if (!activeKeys.includes(key)) {
                this.popupIconBox.remove_actor(icon.actor);
                icon.destroy();
                this.xappIcons.delete(key);
            }
        }

        this._refreshTrayIconReplacementRoles();
    }

    _addXAppIcon(proxy) {
        const key = this._getXAppKey(proxy);

        if (this.xappIcons.has(key)) {
            return;
        }

        const icon = new FoldedXAppStatusIcon(this, proxy);
        this.xappIcons.set(key, icon);
        this.popupIconBox.insert_child_at_index(icon.actor, 0);
        this._updateAppletState();
    }

    _removeXAppIcon(proxy) {
        const key = this._getXAppKey(proxy);

        if (!this.xappIcons.has(key)) {
            return;
        }

        const icon = this.xappIcons.get(key);
        this.popupIconBox.remove_actor(icon.actor);
        icon.destroy();
        this.xappIcons.delete(key);
    }

    _clearXAppIcons() {
        for (let icon of this.xappIcons.values()) {
            this.popupIconBox.remove_actor(icon.actor);
            icon.destroy();
        }

        this.xappIcons.clear();
    }

    _onSystrayRolesChanged() {
        this._syncXAppIcons();

        this._maybeRebuildContextMenu();
        this._updateAppletState();
    }

    _onBeforeLegacyRedisplay() {
        this._clearLegacyIcons();
    }

    _onLegacyIconAdded(dispatcher, icon, role) {
        role = normalizeRole(role);
        this._markRole(role, "legacy", true);

        if (this._isHiddenRole(role)) {
            this._addLegacyIcon(icon, role);
        }

        this._refreshTrayIconReplacementRoles();
        this._maybeRebuildContextMenu();
        this._updateAppletState();
    }

    _onLegacyIconRemoved(dispatcher, icon) {
        let removed = false;

        for (let role in this.legacyIcons) {
            if (this.legacyIcons[role].icon === icon) {
                this._markRole(role, "legacy", false);
                this._removeLegacyIcon(role);
                removed = true;
                break;
            }
        }

        if (removed) {
            this._refreshTrayIconReplacementRoles();
        }

        this._maybeRebuildContextMenu();
        this._updateAppletState();
    }

    _addLegacyIcon(icon, role) {
        if (this.legacyIcons[role]) {
            return;
        }

        const parent = icon.get_parent();
        if (parent) {
            parent.remove_actor(icon);
        }

        const box = new St.Bin({
            style_class: "tray-fold-popup-icon",
            reactive: !global.settings.get_boolean("panel-edit-mode"),
            track_hover: true,
            child: icon
        });
        this._stylePopupIconActor(box);
        box.connect("notify::hover", () => {
            this._stylePopupIconActor(box);
        });

        icon.set_x_align(Clutter.ActorAlign.CENTER);
        icon.set_y_align(Clutter.ActorAlign.FILL);
        icon.reactive = true;
        icon.visible = true;
        icon.opacity = 255;
        icon.set_size(this.getPanelIconSize(St.IconType.FULLCOLOR) * global.ui_scale,
                      this.getPanelIconSize(St.IconType.FULLCOLOR) * global.ui_scale);
        icon.connect("event", Lang.bind(this, this._onLegacyIconEvent));

        this.legacyIcons[role] = { actor: box, icon };
        this.popupIconBox.insert_child_at_index(box, 0);
        this._updateAppletState();
    }

    _removeLegacyIcon(role) {
        if (!this.legacyIcons[role]) {
            return;
        }

        const record = this.legacyIcons[role];
        this.popupIconBox.remove_actor(record.actor);
        record.actor.destroy();
        delete this.legacyIcons[role];
    }

    _clearLegacyIcons() {
        for (let role in this.legacyIcons) {
            this._removeLegacyIcon(role);
        }
    }

    _onLegacyIconEvent(icon, event) {
        const eventType = event.type();
        const button = icon.get_parent();

        if (!button) {
            return GLib.SOURCE_REMOVE;
        }

        if (eventType === Clutter.EventType.BUTTON_PRESS) {
            global.begin_modal(Meta.ModalOptions.POINTER_ALREADY_GRABBED, event.time);
        } else if (eventType === Clutter.EventType.ENTER) {
            button.add_style_pseudo_class("hover");
        } else if (eventType === Clutter.EventType.LEAVE) {
            button.remove_style_pseudo_class("hover");
        }

        const result = icon.handle_event(eventType, event);

        if (eventType === Clutter.EventType.BUTTON_PRESS) {
            global.end_modal(event.time);
        }

        return result;
    }

    _refreshAllIcons() {
        for (let icon of this.xappIcons.values()) {
            icon.refresh();
        }

        for (let role in this.legacyIcons) {
            const icon = this.legacyIcons[role].icon;
            icon.set_size(this.getPanelIconSize(St.IconType.FULLCOLOR) * global.ui_scale,
                          this.getPanelIconSize(St.IconType.FULLCOLOR) * global.ui_scale);
        }
    }

    _redisplayTrayIcons() {
        if (Main.statusIconDispatcher && Main.statusIconDispatcher.redisplay) {
            Main.statusIconDispatcher.redisplay();
        }
    }

    _reloadTrayIcons() {
        this._syncXAppIcons();
        this._refreshTrayIconReplacementRoles();
        this._maybeRebuildContextMenu();
        this._updateAppletState();
        this._redisplayTrayIcons();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new TrayFoldApplet(metadata, orientation, panelHeight, instanceId);
}
