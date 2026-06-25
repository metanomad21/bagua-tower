import { defineConfig } from 'vite';

// WSL2 下用 host:true 把 dev server 暴露给 Windows 浏览器访问
export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2020' },
});
