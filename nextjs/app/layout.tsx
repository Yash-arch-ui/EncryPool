import { Fredoka, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import type { Metadata, Viewport } from "next";
import { DappWrapperWithProviders } from "~~/components/DappWrapperWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
// Template sheet first, Encrypool design system last — its tokens/effects must
// win the cascade inside the Encrypool shell.
import "~~/styles/globals.css";
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
      <head>
        <link href="https://api.fontshare.com/v2/css?f[]=telegraf@400,500,700&display=swap" rel="stylesheet" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased">
        <ThemeProvider enableSystem>
          <DappWrapperWithProviders>{children}</DappWrapperWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default DappWrapper;
