import { Fredoka, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import type { Metadata, Viewport } from "next";
import { DappWrapperWithProviders } from "~~/components/DappWrapperWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/encrypool.css";

const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Encrypool — Save Encrypted. Win Unseen.",
  description: "A confidential, no-loss prize savings experience powered by FHE.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#FFF8F0",
  width: "device-width",
  initialScale: 1,
};

const DappWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`bg-background ${fredoka.variable} ${jakarta.variable} ${jetbrains.variable}`}
    >
      <body suppressHydrationWarning className="font-sans antialiased">
        <ThemeProvider enableSystem>
          <DappWrapperWithProviders>{children}</DappWrapperWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default DappWrapper;
