import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // shadcn semantic tokens (driven by CSS variables in globals.css,
        // themed to the OpenShift / PatternFly palette).
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // OpenShift/PatternFly chrome + status tokens (kept; used by masthead,
        // nav, status badges, meters — the parts shadcn semantics don't cover).
        masthead: "#151515",
        nav: {
          DEFAULT: "#212427",
          hover: "#3c3f42",
          active: "#0f1214",
          border: "#3c3f42",
        },
        canvas: "#f0f0f0",
        ink: {
          DEFAULT: "#151515",
          soft: "#4f5255",
          muted: "#6a6e73",
          faint: "#8a8d90",
        },
        line: {
          DEFAULT: "#d2d2d2",
          soft: "#ededed",
        },
        pf: {
          blue: "#0066cc",
          "blue-hover": "#004080",
          "blue-100": "#bee1f4",
          "blue-50": "#e7f1fa",
          green: "#3e8635",
          "green-50": "#f3faf2",
          red: "#c9190b",
          "red-50": "#faeae8",
          gold: "#f0ab00",
          "gold-50": "#fdf7e7",
          cyan: "#009596",
          purple: "#5752d1",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) + 1px)",
        sm: "calc(var(--radius) - 1px)",
        pf: "3px",
      },
      fontFamily: {
        sans: ["var(--font-rh-text)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-rh-display)", "var(--font-rh-text)", "system-ui", "sans-serif"],
        mono: ["var(--font-rh-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 0.0625rem 0.125rem 0 rgba(3,3,3,0.12), 0 0 0.125rem 0 rgba(3,3,3,0.06)",
        "card-hover": "0 0.25rem 0.5rem 0 rgba(3,3,3,0.16), 0 0 0.25rem 0 rgba(3,3,3,0.08)",
        masthead: "0 0.125rem 0.25rem 0 rgba(3,3,3,0.25)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out both",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
