# 多米成长记录

一个无需 App Store、无需独立后端的离线优先 PWA。程序由 Cloudflare Pages 从 GitHub 私有仓库自动部署；用户记录只在浏览器端加密并保存到当前设备。

## 生产环境

- GitHub 仓库：`MrLPF/duomi-growth`
- 生产分支：`main`
- Cloudflare Pages 项目：`duomi-growth`
- 正式域名：`https://duomi.933520.xyz/`
- 构建命令：留空
- 构建输出目录：`.`

GitHub Pages 工作流已经移除，避免与 Cloudflare Pages 重复部署。

## 功能

- iPhone / Android 添加到主屏幕
- Service Worker 离线缓存
- IndexedDB 本地存储
- PBKDF2-SHA256 派生密钥
- AES-GCM 加密记录
- 5 分钟无操作自动锁定
- 加密备份导出与导入
- 旧 `localStorage` 数据迁移
- Cloudflare Pages Git 自动部署

## Cloudflare Pages 配置

在 Cloudflare Pages 中连接 `MrLPF/duomi-growth`：

```text
Production branch: main
Framework preset: None
Build command: 留空
Build output directory: .
```

在项目的 **Custom domains** 中绑定：

```text
duomi.933520.xyz
```

DNS 中必须存在精确记录，目标为 Pages 项目的实际 `*.pages.dev` 地址，例如：

```text
CNAME  duomi  duomi-growth.pages.dev  Proxied
```

精确的 `duomi` 记录会覆盖 `*.933520.xyz` 通配符 DNS。若仍进入旧服务器，还需检查 Cloudflare Tunnel 的 Public Hostnames、Workers 的 Domains & Routes，以及 Redirect/Origin Rules，确保没有精确的 `duomi.933520.xyz` 指向旧服务，也没有通配符规则拦截该主机名。

## DNS 切换后的缓存清理

如果该域名以前部署过其他网页或 Service Worker，完成 DNS 修复后访问：

```text
https://duomi.933520.xyz/reset.html
```

页面会注销旧 Service Worker、清空该域名的 Cache Storage，然后跳转到新版应用。IndexedDB 中的成长记录不会被该页面删除。

## iPhone 安装

1. 使用 Safari 打开 `https://duomi.933520.xyz/`。
2. 完成首次主密码设置。
3. 点击分享按钮 → **添加到主屏幕**。
4. 首次加载完成后可断网使用。

## 本地测试

不要直接双击 `index.html`，请通过本地 HTTP 服务测试：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 安全边界

网站程序文件可以通过生产域名下载，但成长记录、主密码和解密密钥不会上传到 GitHub 或 Cloudflare，只以密文保存在当前设备。主密码遗失后无法找回。

## 更新缓存

修改程序文件时同步更新 `sw.js` 中的缓存版本。设备下次联网打开应用时会获取新版本。

## 备份建议

至少每月导出一次加密备份，并保存到 iCloud Drive 或其他安全位置。备份仍需原主密码才能恢复。
