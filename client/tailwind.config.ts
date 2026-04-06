import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ipl: { blue: '#003366', gold: '#FFD700', orange: '#FF6B00' },
      },
    },
  },
  plugins: [],
};

export default config;
