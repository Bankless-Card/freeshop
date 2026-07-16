import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/900.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "./globals.css";

import type { Metadata } from "next";
import { Masthead } from "@/components/Masthead";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "freeshop — own your storefront, own your business",
  description:
    "Pay once for a storefront you own outright: an Ethereum escrow contract that accepts ETH and USDC directly, plus a free static storefront you edit and host anywhere. No middlemen, no monthly fees.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <main>
            <Masthead />
            {children}
            <footer className="colophon">
              <span>freeshop launcher</span>
              <span>
                your contract · your website · your business · <a href="/technical">technical details</a>
              </span>
            </footer>
          </main>
        </Providers>
      </body>
    </html>
  );
}
