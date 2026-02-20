/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/dashboard/ui/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        magenta: {
          400: '#e879f9',
        },
      },
    },
  },
  plugins: [],
};
