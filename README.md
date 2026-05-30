# 网易云 OBS 歌词插件

这是一个给 OBS 浏览器源使用的网易云音乐歌词插件，适用于 Windows。

它会读取网易云音乐当前歌曲、歌词和播放进度，在 OBS 中显示可自定义样式的歌词层。当前版本优先使用真实播放进度，并在浏览器源里做平滑显示。

## 包含内容

- 本地歌词服务
- OBS 浏览器源页面
- 外观设置页面
- BetterNCM 自动安装脚本
- BetterNCM 桥接插件
- 一键安装、启动、检查状态、打包脚本

真实同步依赖 BetterNCM 桥接插件。没有桥接插件时，无法稳定获取真实播放进度。

## 快速开始

普通用户直接双击：

```text
Setup and Start.cmd
```

它会自动执行：

1. 准备 Node.js 和 npm 依赖。
2. 构建网易云 OBS 歌词桥接插件。
3. 检测 BetterNCM。
4. 如果没检测到 BetterNCM，并且包内存在 `dist\BetterNCMII.dll`，会尝试自动安装 BetterNCM。
5. 把桥接插件复制到 BetterNCM 插件目录。
6. 启动本地歌词服务。
7. 自动打开测试页面和设置页面。

启动后会打开：

```text
测试页面：http://127.0.0.1:47863/?status=1
设置页面：http://127.0.0.1:47863/settings.html
```

OBS 浏览器源地址：

```text
http://127.0.0.1:47863
```

推荐 OBS 浏览器源尺寸：

```text
1920 x 260
```

## 日常使用

安装过之后，日常只需要双击：

```text
Start OBS Lyrics.cmd
```

它会启动本地服务，并自动打开测试页面和设置页面。

如果只想启动服务、不打开浏览器页面，可以运行：

```powershell
.\launch.ps1
```

如果想用 PowerShell 启动并打开页面：

```powershell
.\launch.ps1 -OpenPages
```

## 外观设置

打开设置页：

```text
http://127.0.0.1:47863/settings.html
```

当前可调整：

- 字体
- 字号
- 对齐方式
- 扫色高亮颜色
- 未扫色文字颜色
- 未扫色透明度
- 上下句透明度
- 歌名/歌手透明度
- 阴影强度
- 是否显示歌名和歌手

保存后，已打开的歌词浏览器源会实时更新。

设置会保存在：

```text
settings.json
```

如果换电脑并想保留样式，把这个文件一起复制过去。

## OBS 设置

在 OBS 中添加：

```text
来源 -> 浏览器
```

URL 填：

```text
http://127.0.0.1:47863
```

建议：

- 宽度：`1920`
- 高度：`260`
- 勾选透明背景相关选项时，OBS 中会显示透明歌词层。

如果修改样式后 OBS 没变化：

```text
右键浏览器源 -> 属性 -> 刷新当前页面
```

或者使用：

```text
刷新当前页面缓存
```

## BetterNCM 说明

本项目需要 BetterNCM 来读取网易云真实播放信息。

如果发布包里包含：

```text
dist\BetterNCMII.dll
```

`Setup and Start.cmd` 会尝试自动安装 BetterNCM，把它复制到网易云音乐安装目录，文件名为：

```text
msimg32.dll
```

如果网易云音乐安装在 `Program Files` 等需要管理员权限的位置，脚本会弹出 UAC 权限确认。

如果自动安装失败，需要手动处理：

1. 安装 BetterNCM。
2. 打开 BetterNCM 插件管理器。
3. 导入：

```text
dist\netease-obs-lyrics-bridge.plugin
```

4. 启用插件。
5. 重启网易云音乐。

## 检查状态

双击：

```text
Check Status.cmd
```

或运行：

```powershell
.\health.ps1
```

正常状态类似：

```text
Bridge: connected
Reliable progress: True
Progress source: localStorage:lastPlaying
Health: ok
```

如果 `Bridge` 不是 `connected`，通常是 BetterNCM 或桥接插件没有正常启用。

## 新电脑部署注意事项

新电脑至少需要：

- Windows
- 网易云音乐 PC 版
- 可联网环境
- OBS

首次运行 `Setup and Start.cmd` 时会自动准备 Node.js。如果电脑没有 Node.js，会下载到项目内的：

```text
.runtime\node
```

常见注意点：

- 网易云音乐需要重启一次，BetterNCM 才会加载。
- 如果弹出管理员权限确认，需要允许，否则 BetterNCM 可能无法安装到网易云目录。
- 杀毒软件可能会拦截 DLL 注入类加载器，需要加入信任。
- 本地服务使用端口 `47863`，如果端口被占用，启动会失败。
- OBS 或 Chrome 缓存旧页面时，需要强制刷新。

## URL 参数

设置页适合普通用户。高级用户也可以通过 URL 参数临时覆盖部分样式：

```text
http://127.0.0.1:47863?fontSize=64&accent=%23ffdd55&align=center&meta=1
```

可用参数：

- `fontSize`：当前歌词字号，默认 `58`
- `accent`：扫色高亮颜色，`#` 需要写成 `%23`
- `align`：`left`、`center`、`right`
- `font`：字体名
- `meta`：`1` 显示歌名/歌手，`0` 隐藏
- `status`：`1` 显示调试状态
- `smooth`：`1` 开启平滑，`0` 关闭

URL 参数优先级高于设置页。

## 打包发布

构建发布 zip：

```powershell
.\scripts\package-release.ps1
```

输出：

```text
dist\netease-obs-lyrics-windows.zip
```

## 接口

本地服务接口：

- `GET /state`：当前歌词、歌曲、进度和设置状态
- `GET /api/fonts`：扫描到的系统字体
- `GET /api/settings`：当前外观设置
- `POST /api/settings`：保存外观设置
- `GET /api/bridge/status`：BetterNCM 桥接状态
- `POST /api/player-state`：桥接插件上报播放状态
