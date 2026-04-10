import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'autoloop',
  description: 'Autonomous loop orchestration for AI agents',
  base: '/autoloop/',
  srcExclude: [
    '**/rfcs/**',
    '**/plans/**',
    '**/reports/**',
    '**/launches/**',
    '**/archive-*'
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/installation' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'GitHub', link: 'https://github.com/mikeyobrien/autoloop' }
    ],
    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Quick Start', link: '/getting-started/quick-start' }
          ]
        },
        {
          text: 'Guides',
          items: [
            { text: 'Creating Presets', link: '/guides/creating-presets' },
            { text: 'Auto Workflows', link: '/guides/auto-workflows' },
            { text: 'Operating Playbook', link: '/guides/operating-playbook' }
          ]
        },
        {
          text: 'Features',
          items: [
            { text: 'Worktree Isolation', link: '/features/worktree' },
            { text: 'Dynamic Chains', link: '/features/dynamic-chains' },
            { text: 'Dashboard', link: '/features/dashboard' },
            { text: 'Profiles', link: '/features/profiles' },
            { text: 'Tasks', link: '/features/tasks' },
            { text: 'LLM Judge', link: '/features/llm-judge' },
            { text: 'Operator Health', link: '/features/operator-health' }
          ]
        },
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Topology & Routing', link: '/reference/topology' },
            { text: 'Memory System', link: '/reference/memory' },
            { text: 'Journal Format', link: '/reference/journal' },
            { text: 'Metareview', link: '/reference/metareview' }
          ]
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Platform Architecture', link: '/concepts/platform' }
          ]
        },
        {
          text: 'Development',
          items: [
            { text: 'Releasing', link: '/development/releasing' }
          ]
        }
      ]
    },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mikeyobrien/autoloop' }
    ],
    editLink: {
      pattern: 'https://github.com/mikeyobrien/autoloop/edit/main/docs/:path'
    }
  }
})
