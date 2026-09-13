/** @type {import('next').NextConfig} */
const nextConfig = {
  // 说明：本沙箱禁止 Node 以「管道(pipe)」方式创建子进程（EPERM）。
  // `next build` 的若干阶段（类型检查、页面数据收集）会 fork 子进程并捕获输出，
  // 因此在构建期关闭这些并行子进程，改为单进程执行；
  // 类型安全由 `npm run typecheck`（直接运行 tsc）单独保证。
  typescript: { ignoreBuildErrors: true },
  experimental: {
    cpus: 1,
    workerThreads: false,
  },

  // 允许以 127.0.0.1 访问开发服务器。
  //
  // 背景：Next.js 16 默认只信任 localhost 作为开发来源，对其它 Host
  // 会拦截其开发资源请求（返回 403），例如 /_next/hmr。
  // 若用 http://127.0.0.1:3000 打开页面，客户端运行时资源会被拦截，
  // React 无法接管页面，页面就会一直停留在服务端渲染的初始状态（如「加载中…」）。
  // 加上这里之后即可正常访问。
  allowedDevOrigins: ['127.0.0.1', 'localhost', '[::1]'],
};

export default nextConfig;
