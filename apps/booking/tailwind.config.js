/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#244B70",
        blue: { DEFAULT: "#3979A8" },
        surface: "#FFFFFF",
        border: "#E5E9ED",
        ink: "#203247",
        muted: "#748294",
        success: "#2E7D5B",
        warning: "#B7791F",
        error: "#C0392B",
      },
      fontFamily: {
        sans: ["'Be Vietnam Pro'", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
