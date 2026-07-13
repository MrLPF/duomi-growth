# 多米的成长记录

这是从原始归档恢复的粉色宝宝成长日记网页，使用 Cloudflare Pages 从 GitHub 私有仓库自动部署。

## 生产环境

- GitHub 仓库：`MrLPF/duomi-growth`
- 生产分支：`main`
- Cloudflare Pages 项目：`duomi-growth`
- 正式地址：`https://duomi.933520.xyz/`
- 构建命令：留空
- 构建输出目录：`.`

GitHub Pages 工作流已经移除，避免与 Cloudflare Pages 重复部署。

## 已恢复的界面与功能

- 原始粉色卡片、星星与气泡装饰
- 每日喝奶记录、母乳/奶粉分类和当日累计
- 成长记录新增、编辑、删除和分页
- 身高、体重成长曲线
- WHO 近似参考曲线和发育比例提示
- 宝宝姓名和出生日期设置
- iPhone、Android 添加到主屏幕
- Service Worker 离线缓存

## 数据保存说明

当前版本严格恢复了原始网页的数据结构，使用浏览器 `localStorage` 保存：

- `childGrowthInfo`
- `childGrowthRecords`
- `childMilkRecords`

这些数据不会自动上传到 GitHub 或 Cloudflare，但**当前版本没有对本地数据加密，也没有服务器账户同步或找回功能**。清除浏览器网站数据、删除主屏幕 Web App 或系统回收网站存储时，记录可能丢失。

## Cloudflare Pages 配置

```text
Production branch: main
Framework preset: None
Build command: 留空
Build output directory: .
```

Custom domain：

```text
duomi.933520.xyz
```

DNS 应存在精确记录，并指向 Pages 项目的实际 `*.pages.dev` 地址：

```text
CNAME  duomi  duomi-growth.pages.dev  Proxied
```

精确的 `duomi` 记录应覆盖 `*.933520.xyz` 通配符 DNS。若仍进入旧服务器，需要检查 Tunnel Public Hostnames、Workers Domains & Routes、Redirect Rules 和 Origin Rules。

## 首次打开与离线使用

1. 联网打开 `https://duomi.933520.xyz/`。
2. 输入宝宝信息，确认三个导航页面可正常切换。
3. 重新加载页面一次，让 Service Worker 接管并缓存 Chart.js。
4. Safari 分享 → 添加到主屏幕。
5. 开启飞行模式后测试页面和已有记录。

图表库首次从 jsDelivr 加载，成功加载后由 Service Worker 缓存；其他核心页面资源直接由本站缓存。

## 清理旧版本缓存

域名曾部署过其他页面时，访问：

```text
https://duomi.933520.xyz/reset.html
```

该页面会注销旧 Service Worker、清理 Cache Storage 并跳转到新版应用。它不会主动删除 `localStorage` 中的成长和喝奶记录。

## 发布版本

当前恢复版本：`2026.07.13-exact-design`
