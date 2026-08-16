import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Boldstep brand — Dark Blue #1e3a8a + Cream #f5f3f0
        navy: {
          50: '#eef2ff',
          100: '#dbe3fb',
          200: '#b8c7f5',
          300: '#8ea5ec',
          400: '#5d7ce0',
          500: '#3b5bd0',
          600: '#2a45b0',
          700: '#1e3a8a',
          800: '#182e6d',
          900: '#132352',
          950: '#0b1533',
        },
        cream: {
          50: '#fdfcfb',
          100: '#f5f3f0',
          200: '#e9e5df',
          300: '#d8d1c7',
          400: '#bdb3a4',
          500: '#9d9081',
        },
        brand: {
          blue: '#1e3a8a',
          cream: '#f5f3f0',
        },
        surface: {
          DEFAULT: '#0b1533',
          raised: '#132352',
          overlay: '#182e6d',
          border: 'rgba(245, 243, 240, 0.12)',
        },
        accent: {
          DEFAULT: '#f0b429',
          success: '#34d399',
          danger: '#f87171',
          warning: '#fbbf24',
          info: '#60a5fa',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11, 21, 51, 0.4), 0 8px 24px -12px rgba(11, 21, 51, 0.6)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
