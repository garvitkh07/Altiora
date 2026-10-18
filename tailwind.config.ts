import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ivory: "#f8f3e8",
        ink: "#2e2a24",
        muted: "#746d61",
        sage: "#78917e",
        "sage-dark": "#4e6a59",
        amber: "#d99454",
        clay: "#b86e56",
        mist: "#eee9de",
      },
      boxShadow: {
        glass: "0 20px 60px rgba(80, 62, 38, 0.10)",
        soft: "0 8px 26px rgba(80, 62, 38, 0.09)",
      },
      fontFamily: {
        sans: ["var(--font-ui)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
