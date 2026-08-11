/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#fff8f0",
          100: "#f5f2ee",
          200: "#eae4dc",
          300: "#d4cbc0",
          600: "#6e5c55",
          700: "#57423d",
          800: "#33302b",
          900: "#1a1a1a",
        },
        ember: {
          500: "#d45d40",
          600: "#a2391f",
          700: "#85240b",
        },
        warm: {
          canvas: "#f5f2ee",
          paper: "#fff8f0",
          line: "#eae4dc",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        surface: "0 4px 12px rgba(26, 26, 26, 0.04)",
        float: "0 8px 24px rgba(26, 26, 26, 0.08)",
      },
    },
  },
  plugins: [],
};
