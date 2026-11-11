/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Locked tokens — DESIGN_SYSTEM.md §2. Navy/Blue là màu chủ đạo duy nhất.
        navy: { DEFAULT: "#244B70", 700: "#1B3A57", 600: "#2C5A86" },
        blue: { DEFAULT: "#3979A8" },
        surface: "#FFFFFF",
        border: "#E5E9ED",
        ink: "#203247",
        muted: "#748294",
        success: "#2E7D5B",
        warning: "#B7791F",
        error: "#C0392B",
        // Soft blue tint scale — dẫn xuất từ Navy/Blue, dùng cho nền nhạt,
        // badge, highlight và trạng thái active. Không thêm họ màu mới.
        tint: {
          50: "#F2F6F9",
          100: "#E6EEF4",
          200: "#D3E0EB",
          300: "#B9CDDD",
        },
        // Nền nhạt cho trạng thái — chỉ dùng khi mang ý nghĩa trạng thái.
        soft: {
          success: "#EAF4EF",
          warning: "#FAF3E3",
          error: "#FBECEA",
        },
      },
      fontFamily: {
        sans: ["'Nunito'", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Card chỉ dùng shadow rất nhẹ — DESIGN_SYSTEM.md §4.
        soft: "0 1px 2px rgba(32, 50, 71, 0.06), 0 1px 3px rgba(32, 50, 71, 0.04)",
      },
    },
  },
  plugins: [],
};
