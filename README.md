# 多米成长记录

一个无需 App Store、无需服务器后端的离线优先 PWA。程序通过 GitHub Pages 发布；用户记录只在浏览器端加密并保存到当前设备。

## 功能

- iPhone / Android 添加到主屏幕
- Service Worker 离线缓存
- IndexedDB 本地存储
- PBKDF2-SHA256 派生密钥
- AES-GCM 加密记录
- 5 分钟无操作自动锁定
- 加密备份导出与导入
- 旧 `localStorage` 数据迁移
- GitHub Actions 自动部署 Pages

## 安全边界

普通 GitHub Pages 网址仍然是公开的。访问者可以下载应用的静态代码，但无法访问某台设备上保存的记录。个人记录、主密码和解密密钥不会上传到 GitHub。主密码遗失后无法找回。

## 开启 GitHub Pages

1. 合并功能分支到 `main`。
2. 仓库进入 **Settings → Pages**。
3. 在 **Build and deployment** 中将 Source 设为 **GitHub Actions**。
4. 打开 Actions 页面，等待 `Deploy GitHub Pages` 成功。
5. 访问 `https://mrlpf.github.io/duomi-growth/`。

## iPhone 安装

1. 使用 Safari 打开 Pages 地址。
2. 完成首次主密码设置。
3. 点击分享按钮 → **添加到主屏幕**。
4. 首次加载完成后可断网使用。

## 更新缓存

修改程序文件时，将 `sw.js` 中的 `CACHE` 版本从 `v1` 改为 `v2` 等新值，提交并部署。设备下次联网打开应用时会获取新版本。

## 备份建议

至少每月导出一次加密备份，并保存到 iCloud Drive 或其他安全位置。备份仍需原主密码才能恢复。
