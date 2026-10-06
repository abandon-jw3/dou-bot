import type { DefaultTheme } from 'vitepress';
export const sidebar: DefaultTheme.Sidebar = {
  '/guide/': [
    {
      text: '开始使用',
      items: [
        {
          text: '框架介绍',
          link: '/guide/introduction',
        },
        {
          text: '快速开始',
          link: '/guide/quick-start',
        },
        {
          text: '项目结构与编译',
          link: '/guide/project',
        },
      ],
    },
    {
      text: '编写业务',
      items: [
        {
          text: '模块与依赖注入',
          link: '/guide/modules',
        },
        {
          text: '生命周期',
          link: '/guide/lifecycle',
        },
        {
          text: '命令与帮助',
          link: '/guide/commands',
        },
        {
          text: '参数、Slot 与 Rest',
          link: '/guide/parameters',
        },
        {
          text: 'Guard 与冷却',
          link: '/guide/guards',
        },
        {
          text: '场景、用户与群角色',
          link: '/guide/access',
        },
        {
          text: '发送消息与图片',
          link: '/guide/messages',
        },
        {
          text: 'Markdown 与按钮',
          link: '/guide/buttons',
        },
        {
          text: '二次输入与多轮对话',
          link: '/guide/prompts',
        },
        {
          text: '原始事件',
          link: '/guide/events',
        },
      ],
    },
    {
      text: '接入与运行',
      items: [
        {
          text: 'WebSocket 接入',
          link: '/guide/ws',
        },
        {
          text: 'Webhook 接入',
          link: '/guide/webhook',
        },
        {
          text: '完整配置',
          link: '/guide/configuration',
        },
        {
          text: '离线测试',
          link: '/guide/testing',
        },
        {
          text: 'Windows 部署',
          link: '/guide/deployment',
        },
        {
          text: '错误与排查',
          link: '/guide/troubleshooting',
        },
      ],
    },
  ],
  '/api/': [
    {
      text: 'API 参考',
      items: [
        {
          text: '装饰器参考',
          link: '/api/decorators',
        },
        {
          text: '应用与配置',
          link: '/api/application',
        },
        {
          text: '上下文与对话结果',
          link: '/api/contexts',
        },
        {
          text: '消息与按钮工具',
          link: '/api/messages',
        },
        {
          text: 'QQClient 与 QQApi',
          link: '/api/client',
        },
        {
          text: '错误、日志与类型',
          link: '/api/errors',
        },
        {
          text: '测试入口',
          link: '/api/testing',
        },
        { text: '类型与接口', link: '/api/types' },
      ],
    },
  ],
  '/examples/': [
    {
      text: '完整示例',
      items: [
        {
          text: '最小 hello',
          link: '/examples/hello',
        },
        {
          text: '无序参数与 City',
          link: '/examples/query',
        },
        {
          text: '三级 Guard',
          link: '/examples/guards',
        },
        {
          text: '两轮问答',
          link: '/examples/prompt',
        },
        {
          text: 'Markdown 与按钮',
          link: '/examples/buttons',
        },
      ],
    },
  ],
};
