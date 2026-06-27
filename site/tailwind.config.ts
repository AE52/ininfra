import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#07090E",
        panel: "#0C1018",
        hairline: "#1B2230",
        ink: "#E6EBF2",
        muted: "#9AA7B8",
        faint: "#5C6B80",
        brand: {
          violet: "#7C5CFF",
          blue: "#3B82F6",
          cyan: "#22D3EE",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      backgroundImage: {
        brand: "linear-gradient(120deg,#7C5CFF,#3B82F6,#22D3EE)",
      },
      keyframes: {
        "caret-blink": {
          "0%,49%": { opacity: "1" },
          "50%,100%": { opacity: "0" },
        },
        "glow-drift": {
          "0%,100%": { transform: "translate3d(-4%,-2%,0) scale(1)" },
          "50%": { transform: "translate3d(4%,3%,0) scale(1.08)" },
        },
      },
      animation: {
        "caret-blink": "caret-blink 1.05s steps(1) infinite",
        "glow-drift": "glow-drift 18s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
