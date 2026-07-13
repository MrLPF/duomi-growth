# 多米的成长记录

本仓库部署用户提供的 `归档.zip` 页面，用于记录宝宝信息、成长数据和每日喝奶情况。

## 生产部署

- 生产分支：`main`
- Cloudflare Pages 项目：`duomi-growth`
- 正式域名：`https://duomi.933520.xyz/`
- Framework preset：`None`
- 构建命令：留空
- 构建输出目录：`.`

这是纯静态 PWA，不需要安装依赖或执行构建。运行时入口和资源为：

- `index.html`
- `chart.umd.min.js`
- `manifest.json`
- `sw.js`
- `icons/icon-192.png`
- `icons/icon-512.png`

页面数据由浏览器本地存储保存，不会由该静态站点上传到服务器。清除浏览器网站数据会同时清除本地记录。

## 本地测试

不要直接双击 `index.html`。请在仓库根目录启动 HTTP 服务：

```bash
python -m http.server 8080
```

然后访问 `http://127.0.0.1:8080/`。

## 发布边界

Cloudflare Pages 直接发布仓库根目录。仓库不再使用会重建或覆盖根页面的 GitHub Pages 工作流，避免部署内容与 `main` 不一致。
