# Tray Fold：Cinnamon 托盘折叠

[English](README.md)

将选定的托盘图标收进弹出区域，类似 Windows 的隐藏托盘图标功能。当前 **0.1.0** 为早期版本。

![使用临时演示图标的真实弹出区域](docs/tray-fold-demo.png)

## 环境与依赖

已验证：**Linux Mint 22.3、Cinnamon 6.6.9、X11**。请保留 Cinnamon 自带的 **XApp 状态小程序**和**系统托盘**，用于显示未折叠的图标。该项目用于 Cinnamon 桌面。

其他 Cinnamon 版本和 Wayland 尚未实测。代码在 Wayland 下跳过 X11 专用的旧式托盘接口，但尚不能据此保证 Wayland 可用。应用的 XApp 支持取决于其托盘实现和桌面集成；平滑滚动暂不转发。

安装需要 Bash、`rsync` 和 `gettext`（提供 `msgfmt`）。Mint/Ubuntu 可执行：

```bash
sudo apt install rsync gettext
```

## 安装与更新

下载或克隆仓库，在项目目录中执行，**不要使用 sudo**：

```bash
./install.sh
```

脚本会安装到 `~/.local/share/cinnamon/applets/tray-fold@kelvin`，编译并安装中文翻译，同时复制许可证和来源声明。更新会清理该安装目录中的旧文件，保留 Cinnamon 设置。

在 Cinnamon 的“小程序”设置中添加 **Tray Fold／托盘折叠**。已经添加的实例可执行以下命令重载：

```bash
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon --method org.Cinnamon.ReloadXlet 'tray-fold@kelvin' 'APPLET'
```

如果新小程序或翻译尚未显示，注销后重新登录。

## 使用

1. 右键折叠按钮，进入“已折叠的托盘图标”。
2. 开启目标应用的开关，将图标折叠；关闭开关，恢复到普通托盘。
3. 左键折叠按钮打开弹出区域。图标保留应用的点击、右键菜单及离散滚动交互；点击区域外或按 Esc 关闭。
4. 需要刷新时，选择“重新加载托盘图标”。

小程序设置可控制空托盘时是否显示按钮，以及提示文字是否显示数量。退出的应用会保留已保存的选择；取消其开关即可清除选择。列表优先显示桌面应用名称，内部使用托盘角色识别应用；身份在重启后变化的应用可能需要重新选择。

## 卸载与恢复

先在小程序设置中**从面板移除 Tray Fold**，让小程序释放托盘替换并恢复原图标，然后执行：

```bash
./uninstall.sh
```

卸载会删除小程序和已编译翻译，保留设置，方便重新安装。若需完全重置，在从面板移除后执行：

```bash
rm -rf -- "$HOME/.config/cinnamon/spices/tray-fold@kelvin"
```

如果普通托盘中的图标仍未恢复，检查自带托盘小程序是否开启，再重启对应应用；注销并重新登录可重建桌面托盘会话。

## 检查与反馈

安装 Node.js 18+、Python 3、`rsync`、`gettext` 后执行：

```bash
./scripts/check.sh
```

检查包含语法、JSON、翻译、生命周期回归测试，以及临时 HOME 中的安装、更新和卸载。GitHub Actions 会在推送和拉取请求中运行这些检查。

真实桌面验证需先安装、启用并重载当前版本，然后运行：

```bash
python3 tests/smoke_desktop.py
```

需要 `python3-gi`、`gir1.2-gtk-3.0`、`gir1.2-xapp-1.0`。测试会创建临时图标、临时改变折叠选择和弹出方向、打开演示菜单并重载小程序；结束时恢复原选择和方向。详见[验证记录及范围](docs/TESTING.md)。

反馈问题时请附 Cinnamon 版本、发行版、X11／Wayland 会话类型、受影响应用、复现步骤及 Looking Glass 或 `~/.xsession-errors` 中相关错误。发送日志前请检查私人信息。

## 许可

使用 **GPL-2.0-or-later**，完整文本见 [LICENSE](LICENSE)。XApp 图标绘制、事件转发与旧式托盘事件处理包含 Cinnamon 自带小程序的改编；上游来源及版权记录见 [NOTICE](NOTICE)。
