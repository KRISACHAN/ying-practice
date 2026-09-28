import type { NextConfig } from "next";

const config: NextConfig = {
  // 仓库根目录也有锁文件；明确让 Turbopack 以当前示例为根。
  turbopack: { root: process.cwd() },
};

export default config;
