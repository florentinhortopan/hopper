/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "var(--ink-50)",
          100: "var(--ink-100)",
          200: "var(--ink-200)",
          300: "var(--ink-300)",
          600: "var(--ink-600)",
          700: "var(--ink-700)",
          800: "var(--ink-800)",
          900: "var(--ink-900)",
        },
        ember: {
          500: "var(--ember-500)",
          600: "var(--ember-600)",
          700: "var(--ember-700)",
          800: "var(--ember-800)",
          950: "var(--ember-950)",
        },
        warm: {
          canvas: "var(--warm-canvas)",
          paper: "var(--warm-paper)",
          line: "var(--warm-line)",
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
