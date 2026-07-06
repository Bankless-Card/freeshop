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
  title: "freeshop — launch a self-hosted crypto storefront",
  description:
    "Deploy your own escrow contract and get a free, static storefront. No backend, no processors, your keys.",
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
              <span>your contract · your storefront · your keys</span>
            </footer>
          </main>
        </Providers>
      </body>
    </html>
  );
}
