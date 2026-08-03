import { defineConfig } from 'vitepress'

const enSidebar = [
  { text: 'Quick Start', link: '/en/guide/quick-start' },
  { text: 'Installation', link: '/en/guide/installation' },
  { text: 'PWA', link: '/en/guide/pwa' },
  { text: 'Accounts and Access', link: '/en/guide/accounts' },
  { text: 'Settings Console', link: '/en/guide/settings' },
  { text: 'Projects and Sharing', link: '/en/guide/projects' },
  { text: 'Namespace', link: '/en/guide/namespace' },
  { text: 'How it Works', link: '/en/guide/how-it-works' },
  { text: 'Cursor Agent', link: '/en/guide/cursor' },
  { text: 'Grok Build', link: '/en/guide/grok' },
  { text: 'Voice Assistant', link: '/en/guide/voice-assistant' },
  { text: 'Why HAPI', link: '/en/guide/why-hapi' },
  { text: 'FAQ', link: '/en/guide/faq' }
]

const zhSidebar = [
  { text: '快速开始', link: '/zh-CN/guide/quick-start' },
  { text: '安装', link: '/zh-CN/guide/installation' },
  { text: 'PWA 应用', link: '/zh-CN/guide/pwa' },
  { text: '账号与访问', link: '/zh-CN/guide/accounts' },
  { text: '设置控制台', link: '/zh-CN/guide/settings' },
  { text: '项目与共享', link: '/zh-CN/guide/projects' },
  { text: '命名空间', link: '/zh-CN/guide/namespace' },
  { text: '工作原理', link: '/zh-CN/guide/how-it-works' },
  { text: 'Cursor Agent', link: '/zh-CN/guide/cursor' },
  { text: 'Grok Build', link: '/zh-CN/guide/grok' },
  { text: '语音助手', link: '/zh-CN/guide/voice-assistant' },
  { text: '为什么选择 HAPI', link: '/zh-CN/guide/why-hapi' },
  { text: 'FAQ', link: '/zh-CN/guide/faq' }
]

export default defineConfig({
  title: 'HAPI',
  description: 'Control your AI agents from anywhere',
  base: '/docs/',
  lang: 'en-US',

  head: [
    ['link', { rel: 'icon', href: '/docs/favicon.ico' }],
  ],

  locales: {
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'HAPI',
      description: 'Control your AI agents from anywhere',
      themeConfig: {
        nav: [
          { text: 'Quick Start', link: '/en/guide/quick-start' },
          { text: 'App', link: 'https://app.hapi.run', target: '_blank' }
        ],
        sidebar: enSidebar
      }
    },
    'zh-CN': {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh-CN/',
      title: 'HAPI',
      description: '随时随地控制你的 AI 编程代理',
      themeConfig: {
        nav: [
          { text: '快速开始', link: '/zh-CN/guide/quick-start' },
          { text: '应用', link: 'https://app.hapi.run', target: '_blank' }
        ],
        sidebar: zhSidebar
      }
    }
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Quick Start', link: '/en/guide/quick-start' },
      { text: 'App', link: 'https://app.hapi.run', target: '_blank' }
    ],

    sidebar: enSidebar,

    socialLinks: [
      { icon: 'github', link: 'https://github.com/tiann/hapi' }
    ],

    footer: {
      message: 'Released under the LGPL-3.0 License.',
      copyright: 'Copyright © 2024-present'
    },

    search: {
      provider: 'local'
    }
  },

  vite: {
    server: {
      allowedHosts: true
    }
  }
})
