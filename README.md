# 多米的成长记录

本仓库部署用户提供的 `归档.zip` 页面，用于记录宝宝信息、成长数据和每日喝奶情况。

## 生产部署

- 生产分支：`main`
- Cloudflare Pages 项目：`duomi-growth`
- 正式域名：`https://duomi.933520.xyz/`
- Framework preset：`None`
- 构建命令：留空
- 构建输出目录：`.`

这是纯静态 PWA，生产发布不需要安装依赖或执行构建。运行时入口和资源为：

- `index.html`
- `styles.css`
- `app.js`
- `secure-vault.css`
- `secure-vault.js`
- `chart.umd.min.js`
- `manifest.json`
- `sw.js`
- `icons/icon-192.png`
- `icons/icon-512.png`

页面数据保存在 IndexedDB `duomi-growth-vault-v2` 的本机加密保险箱中，不会由该静态站点上传到服务器。每个浏览器只创建一个本机账户；密码和恢复码分别包裹同一个随机数据密钥，业务数据使用 AES-256-GCM 加密。清除浏览器网站数据仍会删除本机账户和记录，因此应保存恢复码并定期导出 `.duomi` 加密备份。

## 本地测试

安装仅用于测试的开发依赖并运行完整验收：

```bash
npm install
npm test
```

不要直接双击 `index.html`。本地预览请运行：

```bash
npx wrangler pages dev . --port 8788
```

然后访问 `http://127.0.0.1:8788/`。生产仍直接发布仓库根目录，`package.json` 不改变 Pages 的构建方式。

## 发布边界

Cloudflare Pages 直接发布仓库根目录。仓库不再使用会重建或覆盖根页面的 GitHub Pages 工作流，避免部署内容与 `main` 不一致。
