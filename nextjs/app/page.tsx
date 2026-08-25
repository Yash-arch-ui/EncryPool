import { PoolFooter } from "~~/components/pooltogether/Footer";
import { CryptoSection } from "~~/components/pooltogether/home/CryptoSection";
import { HeroSection } from "~~/components/pooltogether/home/HeroSection";
import { MissionSection } from "~~/components/pooltogether/home/MissionSection";
import { SavingSection } from "~~/components/pooltogether/home/SavingSection";

/** Landing page: full port of pooltogether.com's home layout (hero pitch,
 * save-to-win benefits, mission + developers, why-crypto) adapted for the
 * confidential protocol and wired to the on-chain ConfidentialPrizeVault
 * contracts (layout heritage: pooltogether.com, MIT). */
export default function Home() {
  return (
    <main className="relative min-h-screen w-full overflow-x-clip bg-pt-bg-purple-darker font-pt-inter text-white antialiased">
      <HeroSection />
      <SavingSection />
      <MissionSection />
      <CryptoSection />
      <PoolFooter />
    </main>
  );
}
