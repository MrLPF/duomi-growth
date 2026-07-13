# 多米的成长记录

一个只依赖 GitHub Pages 的离线优先 PWA，用于记录宝宝信息、身高体重和每日喝奶数据。无需 App Store、Apple Developer 账号、Xcode、独立服务器或 Cloudflare。

## 功能

- 保留粉色卡片、星星与气泡设计
- 每日喝奶记录、母乳/奶粉分类和当日累计
- 成长记录新增、编辑、删除和分页
- 本地 Canvas 身高体重曲线，不依赖 CDN
- WHO 近似参考曲线和发育比例提示
- iPhone / Android 添加到主屏幕
- Service Worker 缓存全部运行资源，首次加载后可离线使用
- 本机主密码解锁和 5 分钟无操作自动锁定
- IndexedDB 本地加密存储
- PBKDF2-SHA256（600,000 次）派生密钥
- AES-256-GCM 加密宝宝信息、成长记录和喝奶记录
- 加密备份导出、恢复和主密码修改
- 旧版 `localStorage` 数据自动加密迁移

## 安全边界

普通 GitHub Pages 是公开静态网站。知道网址的人可以下载网页程序代码，但程序代码和 GitHub 仓库中不包含你的宝宝记录。

本机账户的作用是解锁当前设备中的加密数据，并不能把 GitHub Pages 网址变成服务端私有网站。个人数据只保存在当前浏览器的 IndexedDB 中，保存前使用 AES-GCM 加密；主密码和解密密钥不会上传到 GitHub。

忘记主密码后无法通过邮箱找回。请定期导出加密备份，并把备份保存到 iCloud Drive 或其他安全位置。

## GitHub Pages 部署

1. 将功能分支合并到 `main`。
2. 打开仓库 **Settings → Pages**。
3. 在 **Build and deployment** 中把 **Source** 设为 **GitHub Actions**。
4. 打开 **Actions**，确认 `Deploy GitHub Pages` 工作流成功。
5. 访问：

```text
https://mrlpf.github.io/duomi-growth/
```

之后每次推送到 `main`，GitHub Actions 都会自动发布新版本。

> 仓库可以是私有仓库，但普通 GitHub Pages 网站仍可能公开。是否能从私有仓库发布 Pages 取决于 GitHub 当前套餐。

## 第一次使用

1. 使用 Safari 打开 GitHub Pages 地址。
2. 设置至少 8 位主密码。
3. 如果浏览器中存在旧版明文记录，应用会在成功创建密码后自动加密迁移，并删除对应的旧 `localStorage` 数据。
4. 填写宝宝信息并测试记录功能。
5. 点击导航栏的 `🔐`，导出第一份加密备份。
6. Safari 分享 → **添加到主屏幕**。
7. 重新打开主屏幕应用，然后开启飞行模式测试离线启动。

## 数据与备份

导航栏的 `🔐` 面板提供：

- 导出加密备份
- 导入加密备份
- 修改主密码
- 立即锁定

备份文件扩展名为 `.duomi`，文件中只包含加密元数据和密文。恢复时必须输入创建该备份时使用的主密码。

修改主密码后，应立即重新导出备份；旧备份仍需要旧密码才能解密。

## 本地测试

不要直接双击 `index.html`。Service Worker、Web Crypto 和部分 PWA 功能需要安全上下文，请使用本地 HTTP 服务：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 自动检查

Pull Request 会运行 `Validate secure offline PWA`，检查：

- JavaScript 语法
- Manifest JSON
- 关键离线文件是否存在
- 页面是否重新引入远程脚本或样式
- 新增资源是否列入 Service Worker 缓存

## 清理旧缓存

曾经打开过旧部署版本时，可以访问：

```text
https://mrlpf.github.io/duomi-growth/reset.html
```

该页面用于注销旧 Service Worker 和清理 Cache Storage。执行前请先导出备份；不要手动清除网站数据，除非确定不再需要本机记录。

## 当前版本

`2026.07.13-secure-offline-v2`
