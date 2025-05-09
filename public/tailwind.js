tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "#fff", // cinza claro
          dark: "#111827", // cinza escuro
          hover: "#1f2937", // cinza escuro com hover
          sidebar: "#111827", // cinza escuro
        },
        card: {
          DEFAULT: "#f9fafb", // cinza claro
          dark: "#1f2937", // cinza escuro
        },
        border: {
          DEFAULT: "#e5e7eb", // cinza claro
          dark: "#374151", // cinza escuro
        },
        text: {
          DEFAULT: "#111827", // cinza escuro
          dark: "#f3f4f6", // cinza claro
        },
        primary: {
          DEFAULT: "#f97316", // laranja
          dark: "#ea580c",
        },
        secondary: {
          DEFAULT: "#0a48c4", // azul
          dark: "#042b7a",
        },
        success: {
          DEFAULT: "#16a34a",
          dark: "#15803d",
        },
        warning: {
          DEFAULT: "#f59e0b",
          dark: "#d97706",
        },
        danger: {
          DEFAULT: "#ef4444",
          dark: "#dc2626",
        },
        info: {
          DEFAULT: "#3b82f6",
          dark: "#2563eb",
        },
      },
    },
  },
};
