import { Kicker } from "@/components/ui/Kicker";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";

export function SectionHeading({
  kicker,
  title,
  description,
  align = "left",
  className,
}: {
  kicker: string;
  title: React.ReactNode;
  description?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      <Kicker>{kicker}</Kicker>
      <h2 className="fluid-h2 mt-3 font-display font-semibold text-ink">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-muted sm:text-[1.05rem]">
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}
