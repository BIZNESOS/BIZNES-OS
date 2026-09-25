/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#141A18",
        paper: "#F7F6F2",
        surface: "#FFFFFF",
        forest: {
          50: "#EEF3F1",
          100: "#D6E3DD",
          300: "#7FA596",
          500: "#2F6B58",
          600: "#1F5344",
          700: "#163B33",
          900: "#0E1613",
        },
        gold: {
          400: "#D4B36A",
          500: "#B68A35",
          600: "#96702A",
        },
        line: "#E4E1D9",
        muted: "#6B7268",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Manrope", "Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "20px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,26,24,0.04), 0 2px 12px rgba(20,26,24,0.05)",
      },
    },
  },
  plugins: [],
};
