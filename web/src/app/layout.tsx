import type { Metadata } from "next"
import { Geist, Geist_Mono, Space_Grotesk, Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] })
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Amber's Angels",
  description: "Amber's Angels is a volunteer-driven AI platform that responds to FEMA IPAWS AMBER Alerts and active missing persons searches. Privacy-first. Veteran-founded. 501(c)(3).",
  icons: {
    icon: '/aa-icon.png',
    apple: '/aa-icon.png',
  },
  openGraph: {
    title: "Amber's Angels",
    description: "Volunteer-driven AI platform helping communities respond to FEMA IPAWS AMBER Alerts and active missing persons searches.",
    url: "https://amberangels.org",
    siteName: "Amber's Angels",
    images: [{ url: "/aa-icon.png", width: 512, height: 512 }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Amber's Angels",
    description: "Volunteer-driven AI platform helping communities respond to FEMA IPAWS AMBER Alerts and active missing persons searches.",
    images: ["/aa-icon.png"],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-950">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
