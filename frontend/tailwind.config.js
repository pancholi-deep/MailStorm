/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // <- IMPORTANT
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mailstormBlue: '#005BBA',
      },
    },
  },
  plugins: [],
}