import type { Metadata } from "next";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "500", "700"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Blinkyoo",
  description: "Sensory focus awareness through intelligent tracking.",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${plusJakartaSans.variable} ${outfit.variable} antialiased min-h-screen relative overflow-x-hidden`}
      >
        <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-violet-400 blur-[150px] opacity-20 pointer-events-none floating-element"></div>
        <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-300 blur-[150px] opacity-20 pointer-events-none floating-element-delayed"></div>
        {children}
      </body>
    </html>
  );
}
