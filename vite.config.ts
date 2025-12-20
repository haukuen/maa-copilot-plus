import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'MaaCopilotPlus',
        namespace: 'https://github.com/HauKuen',
        homepage: 'https://github.com/haukuen/maa-copilot-plus',
        version: '2.3.0',
        description: '增强MAA作业站的筛选功能',
        author: 'haukuen',
        icon: 'https://zoot.plus/favicon-32x32.png?v=1',
        match: [
          'https://prts.plus/*',
          'https://zoot.plus/*'
        ],
        grant: [
          'GM_setValue',
          'GM_getValue',
          'unsafeWindow',
        ],
        'run-at': 'document-start',
        license: 'MIT',
      },
    }),
  ],
});