import { defineConfig } from 'vitepress';
import pkg from '../../package.json';
import { sidebar } from './navigation.js';
export default defineConfig({
  lang: 'zh-CN',
  title: 'dou-bot',
  description: 'QQ 官方机器人的 TypeScript 装饰器框架。完整的中文指南、API 参考与可运行示例。',
  base: '/dou-bot/',
  cleanUrls: false,
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/dou-bot/favicon.svg' }]],
  sitemap: { hostname: 'https://abandon-jw3.github.io/dou-bot/' },
  themeConfig: {
    skipToContentLabel: '跳转到正文',
    siteTitle: 'dou-bot',
    logo: undefined,
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: 'API 参考', link: '/api/decorators' },
      { text: '示例', link: '/examples/hello' },
      { text: '更新日志', link: '/changelog' },
      { text: `v${pkg.devDependencies['dou-bot']}`, link: '/changelog' },
    ],
    sidebar,
    outline: { label: '本页目录', level: [2, 3] },
    socialLinks: [{ icon: 'github', link: 'https://github.com/abandon-jw3/dou-bot' }],
    editLink: {
      pattern: 'https://github.com/abandon-jw3/dou-bot/edit/main/website/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    lastUpdated: { text: '最后更新' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    sidebarMenuLabel: '目录',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    footer: {
      message: '以 MIT 许可证发布 · 文档适用于 dou-bot 0.6.0',
      copyright: '© 2026 dou-bot contributors',
    },
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '显示详细列表',
                resetButtonTitle: '清除搜索',
                backButtonTitle: '关闭搜索',
                noResultsText: '没有找到相关文档',
                footer: {
                  selectText: '选择',
                  selectKeyAriaLabel: '回车',
                  navigateText: '切换',
                  navigateUpKeyAriaLabel: '向上',
                  navigateDownKeyAriaLabel: '向下',
                  closeText: '关闭',
                  closeKeyAriaLabel: 'Esc',
                },
              },
            },
          },
        },
        miniSearch: {
          options: {
            tokenize: (text: string) =>
              Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text))
                .filter((part) => part.isWordLike)
                .map((part) => part.segment),
          },
          searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 4, text: 2, titles: 1 } },
        },
      },
    },
  },
});
