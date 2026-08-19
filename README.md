# dsh-mobile-companion

DSH Web GUI 的手机适配 client-plugin，外加一套带密码保护的局域网访问链路。
纯原创、零第三方素材、MIT 协议。

> ⚠️ **安全提示**：手机访问链路走的是 **HTTP 明文**，传输不加密，
> **安全性无法得到保障**。密码门只能挡住随手访问的人，挡不住抓包监听。
> **仅建议在安全、可信的网络（如家庭 Wi-Fi）内使用**；公共网络、陌生网络
> 中请勿启用。需要更强保护请改用 Tailscale / HTTPS。

## 它能做什么

### 1. 手机布局插件

桌面三栏布局（sidebar | center | details，JS 计算的网格轨道）在手机宽度
（≤768px，或粗指针 ≤1180px）下自动切换为：

- **单栏对话流**：中栏占满全宽，侧栏/详情栏退出文档流
- **抽屉式侧栏**：左上角汉堡按钮开合，遮罩点击 / Esc / 选中会话后自动关闭
- **详情栏浮层**：右侧滑出，沿用产品原生开合控件（`data-details-collapsed`）
- **移动端细节**：`100dvh` 动态视口、safe-area 刘海适配、输入框 ≥16px 防 iOS
  聚焦缩放、代码块/表格横向内滚动、44px 触控目标
- **`crypto.randomUUID` polyfill**：纯 HTTP 来源（非 localhost）下浏览器不提供
  该 API，DSH 客户端每次 RPC 都会调用它——补丁让它能在局域网 HTTP 上正常工作

纯 DOM/CSS 插件：无 cordis 服务依赖、无模型面、零外部运行时导入；所有
DOM/CSS/属性写入都由 `apply()` 返回的 disposer 还原。

### 2. 密码保护的手机访问代理

`lan-proxy-3080.mjs`：手机 → `0.0.0.0:3082`（密码门）→ `127.0.0.1:3080`
（appliance 的 dsh web）。

- 未登录访问只看到登录页，输对密码才发 HttpOnly 会话 cookie
- 通过后把 Host 头改写成回环地址，让 `dsh web`（裸启动、无 `--trusted-host`）
  的 `/api` 信任栏接受手机请求（含 WebSocket / SSE）
- 密码来源：环境变量 `DSH_MOBILE_PASSWORD`，或 `proxy-password.txt` 第一行
- 监听端口来源（可选，默认 3082）：环境变量 `DSH_MOBILE_PORT`，或
  `proxy-port.txt` 第一行；上游 dsh 端口用 `DSH_WEB_PORT`（默认 3080）

## 文件

| 路径 | 作用 |
|---|---|
| `src/client/index.js` | 客户端插件主体（布局状态机 + 抽屉 chrome + polyfill） |
| `src/client/mobile.css` | 全部样式，锁在 `html[data-dsh-mobile]` 作用域 |
| `lib/index.js` | host 侧入口（无行为，纯 ESM） |
| `lib/client.js` | 构建产物：`__ModuleLoader__.load` CJS 工厂包 |
| `build.mjs` | 无依赖构建器（纯 Node，内嵌 CSS） |
| `tests/smoke.mjs` | vm 沙箱冒烟测试 |
| `lan-proxy-3080.mjs` | 密码门 + Host 改写的手机访问代理 |
| `start-mobile-link.ps1` / `.cmd` | 一键：设密码（必填）+ 设端口（可选）+ 起代理 + 打印手机地址 |

## 构建与测试

```sh
node build.mjs        # 重新生成 lib/client.js
node tests/smoke.mjs  # 冒烟测试
```

## 安装为 dsh 插件

```sh
# 把本目录作为 web profile 的 bundle 安装（pnpm 会在 profile 里建 link）
dsh plugin --profile web add -w <path-to-this-directory>
```

装好后重启 `dsh web`（插件集合变更需重启才生效），移动插件即进入
`window.__DSH_BOOT__` 启动图。桌面宽度下它不产生任何可见改动。

## 手机访问（密码门）

```sh
# 交互式：首次运行依次提示「设置访问密码（必填）」「设置代理端口（可选，回车用 3082）」，
# 然后启动代理并打印手机地址
powershell -ExecutionPolicy Bypass -File start-mobile-link.ps1

# 或手动（密码从 proxy-password.txt 读取，端口默认 3082）：
node lan-proxy-3080.mjs
```

手机打开 `http://<电脑局域网IP>:<代理端口>`，先输密码，之后正常使用。电脑端仍用
`http://127.0.0.1:3080`。手机与电脑此时连的是同一台服务器，状态实时同步。

## 安全须知

- dsh 自身没有鉴权层；本代理只补了一道**密码门**，且走的是**明文 HTTP**——
  密码在局域网内传输不加密。它能挡住随手访问的人，但挡不住抓包。
- 需要更强保护时，请置于 Tailscale 等加密覆盖网络之后，或改用 HTTPS。
- **只在可信网络（家庭 Wi-Fi）使用**；公共网络不要跑这个代理。
- `proxy-password.txt` 已被 `.gitignore` 排除，切勿提交。

## License

MIT，见 [LICENSE](LICENSE)。
