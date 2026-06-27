import { Nav } from "@/components/sections/Nav";
import { Hero } from "@/components/sections/Hero";
import { TrustStrip } from "@/components/sections/TrustStrip";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { ConsoleShowcase } from "@/components/sections/ConsoleShowcase";
import { Architecture } from "@/components/sections/Architecture";
import { Security } from "@/components/sections/Security";
import { Quickstart } from "@/components/sections/Quickstart";
import { Demo } from "@/components/sections/Demo";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { Footer } from "@/components/sections/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <Features />
        <HowItWorks />
        <ConsoleShowcase />
        <Architecture />
        <Security />
        <Quickstart />
        <Demo />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
