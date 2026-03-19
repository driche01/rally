/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './src/**/*.{js,ts,jsx,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        coral: {
          50: '#FEF3EE',
          100: '#FCE3D1',
          200: '#F9C4A5',
          300: '#F49D70',
          400: '#ED7040',
          500: '#D85A30',
          600: '#BE4820',
          700: '#9A3918',
          800: '#782B12',
          900: '#551E0C',
        },
        neutral: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#E8E8E8',
          300: '#D1D1D1',
          400: '#A8A8A8',
          500: '#717171',
          600: '#4A4A4A',
          700: '#3A3A3A',
          800: '#222222',
          900: '#111111',
        },
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        medium: ['Inter_500Medium'],
        semibold: ['Inter_600SemiBold'],
        bold: ['Inter_700Bold'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
};
