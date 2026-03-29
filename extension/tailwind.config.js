/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          secondary: '#f8f9fa',
          hover: '#f1f3f5',
          active: '#e9ecef',
        },
        accent: {
          DEFAULT: '#4263eb',
          hover: '#3b5bdb',
          light: '#dbe4ff',
        },
        danger: {
          DEFAULT: '#e03131',
          light: '#ffe3e3',
        },
        warning: {
          DEFAULT: '#f59f00',
          light: '#fff3bf',
        },
        success: {
          DEFAULT: '#2f9e44',
          light: '#d3f9d8',
        },
      },
      fontSize: {
        '2xs': '0.625rem',
      },
      width: {
        'side-panel': '360px',
      },
    },
  },
  plugins: [],
};
