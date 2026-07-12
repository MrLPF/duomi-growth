const statusNode = document.querySelector('#reset-status');

async function resetOfflineRuntime() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }

    statusNode.textContent = '旧缓存已清理，正在打开新版应用……';
    window.setTimeout(() => {
      window.location.replace(`./?cache-reset=${Date.now()}`);
    }, 800);
  } catch (error) {
    console.error(error);
    statusNode.textContent = '自动清理失败。请关闭此页面后使用无痕窗口重新访问，或在 Safari 设置中清除该网站的数据。';
  }
}

resetOfflineRuntime();
