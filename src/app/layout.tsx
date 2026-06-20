// App layout with dark red/black theme
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Gary Budgets — Command Center",
  description: "Social media marketing command center for Gary Budgets",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#0a0a0a] text-gray-100 antialiased`}>{children}</body>
    </html>
  )
}
