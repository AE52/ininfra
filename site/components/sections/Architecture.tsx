import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";

export function Architecture() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="ARCHITECTURE"
          title={
            <>
              A Rust API and a Next.js web,{" "}
              <span className="text-gradient">behind one ingress</span>.
            </>
          }
          description="The browser calls same-origin /api/*, proxied to the Rust API. The API talks to the Kube API via kube-rs, persists audit + config to Postgres, and optionally integrates Jenkins and ECR."
        />

        <Reveal className="mt-12">
          <div className="overflow-x-auto rounded-2xl border border-hairline bg-panel/50 p-4 sm:p-8">
            <svg
              viewBox="0 0 880 360"
              className="mx-auto w-full min-w-[640px] max-w-3xl"
              role="img"
              aria-label="Architecture: Ingress routes to api (Rust) and web (Next.js); api connects to Kube API, Postgres, Jenkins, and ECR."
            >
              <defs>
                <linearGradient id="ag" x1="0" y1="0" x2="880" y2="0">
                  <stop stopColor="#7C5CFF" />
                  <stop offset="0.5" stopColor="#3B82F6" />
                  <stop offset="1" stopColor="#22D3EE" />
                </linearGradient>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L10 5L0 10z" fill="#3B82F6" />
                </marker>
              </defs>

              {/* edges */}
              <g
                stroke="#3B82F6"
                strokeWidth="1.5"
                fill="none"
                markerEnd="url(#arrow)"
                opacity="0.7"
              >
                <path d="M170 60 L170 110" />
                <path d="M140 152 L100 196" />
                <path d="M200 152 L260 196" />
                {/* api to backends */}
                <path d="M100 240 L100 290" />
                <path d="M100 240 C 100 270, 330 270, 360 288" />
                <path d="M100 240 C 100 270, 560 268, 600 288" />
                <path d="M100 240 C 100 270, 790 268, 820 288" />
              </g>

              {/* Ingress */}
              <Node x={110} y={24} w={120} h={36} label="Ingress / LB" />

              <text
                x="120"
                y="135"
                fontFamily="ui-monospace, monospace"
                fontSize="11"
                fill="#5C6B80"
              >
                /healthz · /api
              </text>
              <text
                x="232"
                y="135"
                fontFamily="ui-monospace, monospace"
                fontSize="11"
                fill="#5C6B80"
              >
                / (everything)
              </text>

              {/* api + web */}
              <Node
                x={40}
                y={198}
                w={120}
                h={42}
                label="api"
                sub="Rust · axum · kube-rs"
                accent
              />
              <Node
                x={230}
                y={198}
                w={120}
                h={42}
                label="web"
                sub="Next.js · App Router"
                accent
              />

              {/* backends */}
              <Node x={40} y={290} w={120} h={42} label="Kube API" sub="your cluster" />
              <Node x={300} y={288} w={130} h={44} label="Postgres" sub="audit + config" />
              <Node x={540} y={288} w={130} h={44} label="Jenkins" sub="optional" />
              <Node x={760} y={288} w={110} h={44} label="ECR" sub="optional" />
            </svg>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Node({
  x,
  y,
  w,
  h,
  label,
  sub,
  accent,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="10"
        fill="#0C1018"
        stroke={accent ? "url(#ag)" : "#1B2230"}
        strokeWidth={accent ? "1.5" : "1"}
      />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 4}
        textAnchor="middle"
        fontFamily="var(--font-display), sans-serif"
        fontSize="14"
        fontWeight="600"
        fill="#E6EBF2"
      >
        {label}
      </text>
      {sub ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 13}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="9.5"
          fill="#5C6B80"
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}
