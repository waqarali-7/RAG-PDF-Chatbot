import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocuChat — RAG over your PDFs",
  description:
    "Ask questions about any PDF and get answers grounded in cited source passages. A RAG demo built with Next.js, TypeScript, and the OpenAI API.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
