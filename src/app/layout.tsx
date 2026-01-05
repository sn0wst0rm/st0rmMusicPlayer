import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { Player } from "@/components/player";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeProvider } from "@/components/theme-provider";
import { ModeToggle } from "@/components/mode-toggle";
import { ThemeColorManager } from "@/components/theme-color-manager";
import { QueueSidebar } from "@/components/queue-sidebar";
import { LyricsSidebar } from "@/components/lyrics-sidebar";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "st0rmMusic Player",
  description: "A local music player",
  icons: {
    icon: [
      { url: '/favicon.png', sizes: 'any' },
      { url: '/favicon32.png', sizes: '32x32' }
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground fixed inset-0 w-full h-[100dvh] overflow-hidden overscroll-none flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeColorManager />
          <SidebarProvider className="h-[calc(100%-80px)] overflow-hidden">
            <AppSidebar />
            <SidebarInset className="relative h-full overflow-hidden bg-background text-foreground flex-1 min-w-0">
              <header className="absolute top-0 left-0 right-0 z-40 h-14 px-4 flex items-center gap-2 bg-background/60 backdrop-blur-md border-b transition-colors supports-[backdrop-filter]:bg-background/60">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="h-4" />
                <ModeToggle />
              </header>
              <main className="h-full w-full">
                {children}
              </main>
            </SidebarInset>
            <LyricsSidebar />
            <QueueSidebar />
          </SidebarProvider>
          <Player />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
