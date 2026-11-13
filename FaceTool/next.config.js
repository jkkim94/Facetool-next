/** @type {import('next').NextConfig} */
const path = require('path')

const nextConfig = {
  reactStrictMode: false,
  // Next 16: dev 기본은 Turbopack. webpack 옵션은 `npm run dev:webpack` 전용.
  turbopack: {},
  // turbopack.root 를 __dirname 과 같게 두면 Next 16.x 에서 CSS @import "tailwindcss" 가
  // 상위 폴더(e:\Viewer)에서 resolve 되는 버그가 있습니다. lockfile 은 FaceTool 에만 있으므로
  // root 설정 없이 자동 감지가 맞습니다. 문제 시: npm run dev:webpack
  webpack: (config, { dev }) => {
    if (dev) {
      const ignoreOutside = [
        '**/node_modules/**',
        '**/.git/**',
        path.join(__dirname, '..', 'vendor', 'riglogic_py', 'bake_out'),
        path.join(__dirname, '..', 'vendor', 'DNA', '**', 'Maps'),
        path.join(__dirname, '..', '..', 'DatasetGen'),
        path.join(__dirname, '..', '..', 'results_*'),
      ]
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...(Array.isArray(config.watchOptions?.ignored)
            ? config.watchOptions.ignored
            : config.watchOptions?.ignored
              ? [config.watchOptions.ignored]
              : []),
          ...ignoreOutside,
        ],
      }
    }
    return config
  },
};

module.exports = nextConfig;
