import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DoorDash Credit Optimizer",
  description: "Maximize the value of your DoorDash grocery credits",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" style={{ colorScheme: "light" }}>
      <body className="min-h-full flex flex-col font-sans" style={{ backgroundColor: "#f9fafb", color: "#171717" }}>{children}</body>
    </html>
  );
}
